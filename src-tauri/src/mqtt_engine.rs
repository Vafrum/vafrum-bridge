use rumqttc::tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rumqttc::tokio_rustls::rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    ClientConfig, DigitallySignedStruct, SignatureScheme,
};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, TlsConfiguration, Transport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use once_cell::sync::Lazy;

#[derive(Debug)]
struct NoCertVerifier;

impl ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rumqttc::tokio_rustls::rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rumqttc::tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rumqttc::tokio_rustls::rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

fn make_insecure_tls() -> TlsConfiguration {
    let config = ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertVerifier))
        .with_no_client_auth();
    TlsConfiguration::Rustls(Arc::new(config))
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PrinterConfig {
    pub printer_id: String,
    pub serial: String,
    pub ip: String,
    pub lan_password: String,
    pub model: Option<String>,
}

enum PrinterMsg {
    Stop,
    Publish(Value),
}

struct PrinterHandle {
    tx: mpsc::Sender<PrinterMsg>,
}

static ENGINE: Lazy<Arc<Mutex<HashMap<String, PrinterHandle>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub async fn add_printer(config: PrinterConfig, app: AppHandle) -> Result<(), String> {
    let printer_id = config.printer_id.clone();
    let mut map = ENGINE.lock().await;
    if map.contains_key(&printer_id) {
        return Ok(());
    }
    let (tx, mut rx) = mpsc::channel::<PrinterMsg>(64);
    let cfg = config.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Err(e) = run_printer_task(cfg, &mut rx, app_clone).await {
            eprintln!("[mqtt-engine] printer task error: {}", e);
        }
    });
    map.insert(printer_id, PrinterHandle { tx });
    Ok(())
}

pub async fn remove_printer(printer_id: &str) -> Result<(), String> {
    let mut map = ENGINE.lock().await;
    if let Some(h) = map.remove(printer_id) {
        let _ = h.tx.send(PrinterMsg::Stop).await;
    }
    Ok(())
}

pub async fn publish_command(printer_id: &str, payload: Value) -> Result<(), String> {
    let map = ENGINE.lock().await;
    let h = map.get(printer_id).ok_or_else(|| "printer_not_found".to_string())?;
    h.tx.send(PrinterMsg::Publish(payload))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn run_printer_task(
    cfg: PrinterConfig,
    rx: &mut mpsc::Receiver<PrinterMsg>,
    app: AppHandle,
) -> Result<(), String> {
    let mut opts = MqttOptions::new(
        format!("vafrum-bridge-{}", cfg.serial),
        cfg.ip.clone(),
        8883,
    );
    opts.set_credentials("bblp", &cfg.lan_password);
    opts.set_keep_alive(std::time::Duration::from_secs(30));
    // Bambu-Push-Status können >20 KB werden (AMS + HMS + Cam-Felder).
    // rumqttc-Default ist 10 KB → Endlos-Reconnect bei größeren Frames.
    opts.set_max_packet_size(256_000, 256_000);

    opts.set_transport(Transport::Tls(make_insecure_tls()));

    let (client, mut eventloop) = AsyncClient::new(opts, 64);

    let _ = app.emit(
        "printer-mqtt-diagnostic",
        serde_json::json!({
            "printerId": &cfg.printer_id,
            "serial": &cfg.serial,
            "ip": &cfg.ip,
            "level": "info",
            "message": "mqtt-connecting"
        }),
    );

    let report_topic = format!("device/{}/report", cfg.serial);
    let req_topic = format!("device/{}/request", cfg.serial);

    if let Err(e) = client.subscribe(&report_topic, QoS::AtLeastOnce).await {
        eprintln!("[mqtt-engine:{}] subscribe error: {}", cfg.serial, e);
    }

    // Drucker Zeit geben für ConnAck bevor erstes Pushall
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    let pushall = serde_json::json!({
        "pushing": { "sequence_id": "0", "command": "pushall", "version": 1, "push_target": 1 },
        "user_id": ""
    });
    let _ = client
        .publish(&req_topic, QoS::AtLeastOnce, false, pushall.to_string())
        .await;

    let printer_id = cfg.printer_id.clone();
    let serial = cfg.serial.clone();
    let model = cfg.model.clone();
    let ip = cfg.ip.clone();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(PrinterMsg::Stop) | None => {
                        let _ = client.disconnect().await;
                        return Ok(());
                    }
                    Some(PrinterMsg::Publish(payload)) => {
                        if let Err(e) = client
                            .publish(&req_topic, QoS::AtLeastOnce, false, payload.to_string())
                            .await
                        {
                            eprintln!("[mqtt-engine:{}] publish error: {}", serial, e);
                        }
                    }
                }
            }
            event = eventloop.poll() => {
                match event {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        let _ = app.emit(
                            "printer-mqtt-diagnostic",
                            serde_json::json!({
                                "printerId": &printer_id,
                                "serial": &serial,
                                "ip": &ip,
                                "level": "info",
                                "message": "mqtt-connected"
                            }),
                        );
                    }
                    Ok(Event::Incoming(Packet::Publish(p))) => {
                        if let Ok(text) = std::str::from_utf8(&p.payload) {
                            if let Ok(json) = serde_json::from_str::<Value>(text) {
                                let event_payload = serde_json::json!({
                                    "printerId": printer_id,
                                    "serial": serial,
                                    "model": model,
                                    "raw": json,
                                });
                                let _ = app.emit("printer-mqtt-message", event_payload);
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        let _ = app.emit(
                            "printer-mqtt-diagnostic",
                            serde_json::json!({
                                "printerId": &printer_id,
                                "serial": &serial,
                                "ip": &ip,
                                "level": "error",
                                "message": format!("eventloop error: {}", e)
                            }),
                        );
                        eprintln!("[mqtt-engine:{}] eventloop error: {}", serial, e);
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }
                }
            }
        }
    }
}

/**
 * Bambu MQTT Command Payload Builder — TypeScript-Spiegel zum Rust-Builder
 * `bambu_command_payloads` in apps/vafrum-bridge/src-tauri/src/lib.rs:1307.
 *
 * Source-of-Truth: shared/bridge/__fixtures__/command-payloads.json
 * (Rust-Realität, 54 Test-Vektoren).
 *
 * Drift-Detection läuft aktuell nur über TS-Tests (`commands.test.ts`).
 * Rust-Match wird gegen dieselbe Fixture verifiziert sobald CLI-Wrapper
 * oder serde-Pfad existiert (Phase C2.5/D).
 *
 * Drei sequence_id-Strategien (siehe Fixture _meta.known_quirks):
 *   - default        '0'    — {print:{...}} ohne weitere Felder
 *   - ledPayload     '0' + root user_id '1234567890'  — alle ledctrl
 *   - gcodePayload   '2006' + root user_id '1234567890' — gcode_line, Temp, Fan
 */

export type BuildResult =
  | { ok: true; payloads: Record<string, unknown>[] }
  | { ok: false; error: string };

type Cmd = Record<string, unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────

export function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function asI64(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
    return n;
  }
  return undefined;
}

function commandBool(cmd: Cmd, key: string): boolean | undefined {
  const v = cmd[key];
  return typeof v === 'boolean' ? v : undefined;
}

function commandI64(cmd: Cmd, key: string): number | undefined {
  return asI64(cmd[key]);
}

function commandString(cmd: Cmd, key: string): string | undefined {
  const v = cmd[key];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function commandF64(cmd: Cmd, key: string): number | undefined {
  const v = cmd[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function modelContains(model: string | null | undefined, needles: string[]): boolean {
  const m = (model ?? '').toUpperCase().replace(/ /g, '');
  return needles.some(n => m.includes(n));
}

export function safePathToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 240 ||
    trimmed.includes('..') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  ) {
    return null;
  }
  for (const c of trimmed) {
    const isAlnum = /[a-zA-Z0-9]/.test(c);
    const isAllowed = c === '.' || c === '_' || c === '/' || c === ' ' || c === '-';
    if (!isAlnum && !isAllowed) return null;
  }
  return trimmed;
}

function numberArgInRange(arg: string, prefix: string, min: number, max: number): boolean {
  if (!arg.startsWith(prefix)) return false;
  const tail = arg.slice(prefix.length);
  const n = Number.parseInt(tail, 10);
  if (!Number.isFinite(n) || String(n) !== tail) return false;
  return n >= min && n <= max;
}

export function safeGcodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  for (const ch of trimmed) {
    if (';()@$\\{}'.includes(ch)) return false;
  }
  const parts = trimmed.toUpperCase().split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) return false;

  // ["M84"] | ["M24"]
  if (parts.length === 1 && (parts[0] === 'M84' || parts[0] === 'M24')) return true;
  // ["G28"] alone
  if (parts.length === 1 && parts[0] === 'G28') return true;
  // ["G28", axes...]
  if (parts[0] === 'G28' && parts.length >= 2) {
    const axes = parts.slice(1);
    return axes.length <= 3 && axes.every(a => a === 'X' || a === 'Y' || a === 'Z');
  }
  // ["M107"]
  if (parts.length === 1 && parts[0] === 'M107') return true;
  // ["M107", fan]
  if (parts.length === 2 && parts[0] === 'M107') {
    return parts[1] === 'P1' || parts[1] === 'P2' || parts[1] === 'P3';
  }
  // ["M104", arg]
  if (parts.length === 2 && parts[0] === 'M104') {
    return numberArgInRange(parts[1], 'S', 0, 300);
  }
  // ["M104", tool, arg]
  if (parts.length === 3 && parts[0] === 'M104') {
    return parts[1].startsWith('T') && numberArgInRange(parts[2], 'S', 0, 300);
  }
  // ["M140", arg]
  if (parts.length === 2 && parts[0] === 'M140') {
    return numberArgInRange(parts[1], 'S', 0, 120);
  }
  // ["M106", fan, arg]
  if (parts.length === 3 && parts[0] === 'M106') {
    const fanOk = parts[1] === 'P1' || parts[1] === 'P2' || parts[1] === 'P3';
    return fanOk && numberArgInRange(parts[2], 'S', 0, 255);
  }
  // ["M23", rest...]
  if (parts.length >= 2 && parts[0] === 'M23') {
    const rest = parts.slice(1).join(' ');
    return safePathToken(rest) !== null;
  }
  return false;
}

function normalizedSafeGcode(raw: string): string | null {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0 || lines.length > 12) return null;
  if (!lines.every(l => safeGcodeLine(l))) return null;
  return lines.join('\n') + '\n';
}

function ledPayload(node: string, on: boolean): Record<string, unknown> {
  return {
    system: {
      sequence_id: '0',
      command: 'ledctrl',
      led_node: node,
      led_mode: on ? 'on' : 'off',
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 0,
      interval_time: 0,
    },
    user_id: '1234567890',
  };
}

function gcodePayload(line: string): Record<string, unknown> {
  return {
    print: {
      sequence_id: '2006',
      command: 'gcode_line',
      param: line,
    },
    user_id: '1234567890',
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────

export function buildBambuCommandPayloads(
  command: unknown,
  model: string | null = null,
): BuildResult {
  let cmd: Cmd;
  if (typeof command === 'string') {
    cmd = { type: command };
  } else if (command && typeof command === 'object') {
    cmd = { ...(command as Cmd) };
  } else {
    return { ok: false, error: 'invalid_command' };
  }
  const ty = cmd.type;
  if (typeof ty !== 'string') return { ok: false, error: 'invalid_command' };

  switch (ty) {
    case 'pause':
    case 'resume':
    case 'stop':
      return { ok: true, payloads: [{ print: { sequence_id: '0', command: ty } }] };

    case 'speedLevel': {
      const raw = commandI64(cmd, 'level');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const level = clampInt(raw, 1, 4);
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'print_speed', param: String(level) } }],
      };
    }

    case 'calibration': {
      let option: number;
      const optRaw = commandI64(cmd, 'option');
      if (optRaw !== undefined) {
        option = clampInt(optRaw, 0, 15);
      } else {
        const t = typeof cmd.calibrationType === 'string' ? cmd.calibrationType : '';
        switch (t) {
          case 'bed_level': option = 2; break;
          case 'vibration': option = 4; break;
          case 'flow': option = 1; break;
          case 'full': option = 15; break;
          case 'home': option = 0; break;
          default: return { ok: false, error: 'invalid_command' };
        }
      }
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'calibration', option } }],
      };
    }

    case 'printOption': {
      const print: Record<string, unknown> = {
        sequence_id: '0',
        command: 'print_option',
      };
      let inserted = false;
      const map: Array<[string, string]> = [
        ['soundEnable', 'sound_enable'],
        ['autoRecovery', 'auto_recovery'],
        ['filamentTangleDetect', 'filament_tangle_detect'],
        ['nozzleBlobDetect', 'nozzle_blob_detect'],
        ['airPrintDetect', 'air_print_detect'],
      ];
      for (const [camel, snake] of map) {
        const v = commandBool(cmd, camel);
        if (v !== undefined) {
          print[snake] = v;
          inserted = true;
        }
      }
      if (!inserted) return { ok: false, error: 'invalid_command' };
      return { ok: true, payloads: [{ print }] };
    }

    case 'light':
    case 'chamberLight': {
      const on = commandBool(cmd, 'on');
      if (on === undefined) return { ok: false, error: 'invalid_command' };
      return { ok: true, payloads: [ledPayload('chamber_light', on)] };
    }

    case 'workLight': {
      const on = commandBool(cmd, 'on');
      if (on === undefined) return { ok: false, error: 'invalid_command' };
      if (modelContains(model, ['A1'])) {
        return { ok: true, payloads: [ledPayload('chamber_light', on), ledPayload('work_light', on)] };
      }
      if (modelContains(model, ['H2', 'X1'])) {
        return { ok: true, payloads: [ledPayload('chamber_light2', on)] };
      }
      return { ok: true, payloads: [ledPayload('work_light', on)] };
    }

    case 'heatbedLight': {
      const on = commandBool(cmd, 'on');
      if (on === undefined) return { ok: false, error: 'invalid_command' };
      return { ok: true, payloads: [ledPayload('heatbed_light', on)] };
    }

    case 'partFan':
    case 'auxFan':
    case 'chamberFan': {
      const raw = commandI64(cmd, 'speed');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const speed = clampInt(raw, 0, 100);
      const pwm = Math.round(speed * 2.55);
      const channel = ty === 'partFan' ? 1 : ty === 'auxFan' ? 2 : 3;
      return { ok: true, payloads: [gcodePayload(`M106 P${channel} S${pwm}\n`)] };
    }

    case 'nozzleTemp': {
      const raw = commandI64(cmd, 'temp');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const temp = clampInt(raw, 0, 300);
      return { ok: true, payloads: [gcodePayload(`M104 S${temp}\n`)] };
    }

    case 'nozzle2Temp': {
      const raw = commandI64(cmd, 'temp');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const temp = clampInt(raw, 0, 300);
      return { ok: true, payloads: [gcodePayload(`M104 T1 S${temp}\n`)] };
    }

    case 'bedTemp': {
      const raw = commandI64(cmd, 'temp');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const temp = clampInt(raw, 0, 120);
      return { ok: true, payloads: [gcodePayload(`M140 S${temp}\n`)] };
    }

    case 'gcode': {
      const raw = commandString(cmd, 'gcode');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const safe = normalizedSafeGcode(raw);
      if (safe === null) return { ok: false, error: 'invalid_command' };
      return { ok: true, payloads: [gcodePayload(safe)] };
    }

    case 'gcodeFile': {
      const raw = commandString(cmd, 'param') ?? commandString(cmd, 'fileName');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const param = safePathToken(raw);
      if (param === null) return { ok: false, error: 'invalid_command' };
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'gcode_file', param } }],
      };
    }

    case 'projectFile': {
      const raw = commandString(cmd, 'param');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const param = safePathToken(raw);
      if (param === null) return { ok: false, error: 'invalid_command' };

      const fileRaw = commandString(cmd, 'file');
      const file = fileRaw !== undefined ? (safePathToken(fileRaw) ?? '') : '';

      const mappingRaw = cmd.amsMapping;
      let amsMapping: number[];
      if (Array.isArray(mappingRaw)) {
        amsMapping = mappingRaw
          .map(v => asI64(v))
          .filter((v): v is number => v !== undefined)
          .map(v => clampInt(v, -1, 255))
          .slice(0, 16);
      } else {
        amsMapping = [-1, -1, -1, -1, 0];
      }

      const print: Record<string, unknown> = {
        sequence_id: '0',
        command: 'project_file',
        param,
        project_id: '0',
        profile_id: '0',
        task_id: '0',
        subtask_id: '0',
        subtask_name: commandString(cmd, 'subtaskName') ?? '',
        file,
        url: commandString(cmd, 'url') ?? 'file:///sdcard',
        md5: commandString(cmd, 'md5') ?? '',
        bed_type: commandString(cmd, 'bedType') ?? 'auto',
        timelapse: commandBool(cmd, 'timelapse') ?? false,
        bed_levelling: commandBool(cmd, 'bedLevelling') ?? true,
        flow_cali: commandBool(cmd, 'flowCali') ?? true,
        vibration_cali: commandBool(cmd, 'vibrationCali') ?? true,
        layer_inspect: commandBool(cmd, 'layerInspect') ?? true,
        use_ams: commandBool(cmd, 'useAms') ?? false,
        ams_mapping: amsMapping,
      };
      return { ok: true, payloads: [{ print }] };
    }

    case 'unloadFilament':
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'unload_filament' } }],
      };

    case 'loadFilament': {
      const raw = commandI64(cmd, 'trayId');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const target = clampInt(raw, 0, 255);
      const ams_id = target >= 0 && target < 16 ? Math.trunc(target / 4) : 255;
      const slot_id = target >= 0 && target < 16 ? target % 4 : 0;
      return {
        ok: true,
        payloads: [{
          print: {
            sequence_id: '0',
            command: 'ams_change_filament',
            ams_id,
            slot_id,
            target,
            curr_temp: 220,
            tar_temp: 220,
          },
        }],
      };
    }

    case 'amsDrying': {
      const amsRaw = commandI64(cmd, 'amsId');
      const tempRaw = commandI64(cmd, 'temp');
      const durRaw = commandI64(cmd, 'duration');
      if (amsRaw === undefined || tempRaw === undefined || durRaw === undefined) {
        return { ok: false, error: 'invalid_command' };
      }
      const ams_id = clampInt(amsRaw, 0, 15);
      const temp = clampInt(tempRaw, 0, 90);
      const duration = clampInt(durRaw, 0, 86400);
      const modeRaw = commandI64(cmd, 'mode') ?? 1;
      const mode = clampInt(modeRaw, 0, 10);
      return {
        ok: true,
        payloads: [{
          print: {
            sequence_id: '0',
            command: 'ams_filament_drying',
            ams_id,
            temp,
            cooling_temp: 0,
            duration,
            humidity: 0,
            mode,
            rotate_tray: false,
          },
        }],
      };
    }

    case 'amsUserSetting': {
      const amsRaw = commandI64(cmd, 'amsId');
      const startup = commandBool(cmd, 'startupReadOption');
      const tray = commandBool(cmd, 'trayReadOption');
      if (amsRaw === undefined || startup === undefined || tray === undefined) {
        return { ok: false, error: 'invalid_command' };
      }
      const ams_id = clampInt(amsRaw, 0, 15);
      return {
        ok: true,
        payloads: [{
          print: {
            sequence_id: '0',
            command: 'ams_user_setting',
            ams_id,
            startup_read_option: startup,
            tray_read_option: tray,
          },
        }],
      };
    }

    case 'amsFilamentSetting': {
      const amsRaw = commandI64(cmd, 'amsId');
      const trayRaw = commandI64(cmd, 'trayId');
      const trayColorRaw = commandString(cmd, 'trayColor');
      const minRaw = commandI64(cmd, 'nozzleTempMin');
      const maxRaw = commandI64(cmd, 'nozzleTempMax');
      const trayType = commandString(cmd, 'trayType');
      if (
        amsRaw === undefined || trayRaw === undefined || trayColorRaw === undefined ||
        minRaw === undefined || maxRaw === undefined || trayType === undefined
      ) {
        return { ok: false, error: 'invalid_command' };
      }
      const isHex = /^[0-9A-Fa-f]+$/.test(trayColorRaw);
      if (!(trayColorRaw.length === 6 || trayColorRaw.length === 8) || !isHex) {
        return { ok: false, error: 'invalid_command' };
      }
      const tray_color = trayColorRaw.length === 6 ? `${trayColorRaw}FF` : trayColorRaw;
      const ams_id = clampInt(amsRaw, 0, 255);
      const tray_id = clampInt(trayRaw, 0, 255);
      const nozzle_temp_min = clampInt(minRaw, 0, 320);
      const nozzle_temp_max = clampInt(maxRaw, 0, 320);
      if (nozzle_temp_min > nozzle_temp_max) return { ok: false, error: 'invalid_command' };
      const tray_info_idx = commandString(cmd, 'trayInfoIdx') ?? 'GFL99';

      const print: Record<string, unknown> = {
        sequence_id: '0',
        command: 'ams_filament_setting',
        ams_id,
        tray_id,
        tray_info_idx,
        tray_color,
        nozzle_temp_min,
        nozzle_temp_max,
        tray_type: trayType,
      };
      const settingId = commandString(cmd, 'settingId');
      if (settingId !== undefined) print.setting_id = settingId;
      return { ok: true, payloads: [{ print }] };
    }

    case 'amsControl': {
      const param = typeof cmd.param === 'string' ? cmd.param : undefined;
      if (param === undefined || (param !== 'resume' && param !== 'reset' && param !== 'pause')) {
        return { ok: false, error: 'invalid_command' };
      }
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'ams_control', param } }],
      };
    }

    case 'amsGetRfid': {
      const amsRaw = commandI64(cmd, 'amsId');
      const slotRaw = commandI64(cmd, 'slotId');
      if (amsRaw === undefined || slotRaw === undefined) {
        return { ok: false, error: 'invalid_command' };
      }
      const ams_id = clampInt(amsRaw, 0, 15);
      const slot_id = clampInt(slotRaw, 0, 15);
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'ams_get_rfid', ams_id, slot_id } }],
      };
    }

    case 'timelapse':
    case 'ipcamTimelapse': {
      let enabled = commandBool(cmd, 'enabled');
      if (enabled === undefined) {
        const c = cmd.control;
        if (typeof c === 'string') enabled = c === 'enable';
      }
      if (enabled === undefined) return { ok: false, error: 'invalid_command' };
      return {
        ok: true,
        payloads: [{
          camera: {
            sequence_id: '0',
            command: 'ipcam_timelapse',
            control: enabled ? 'enable' : 'disable',
          },
        }],
      };
    }

    case 'ipcamRecord': {
      let enabled = commandBool(cmd, 'enabled');
      if (enabled === undefined) {
        const c = cmd.control;
        if (typeof c === 'string') enabled = c === 'enable';
      }
      if (enabled === undefined) return { ok: false, error: 'invalid_command' };
      return {
        ok: true,
        payloads: [{
          camera: {
            sequence_id: '0',
            command: 'ipcam_record_set',
            control: enabled ? 'enable' : 'disable',
          },
        }],
      };
    }

    case 'xcamControl': {
      const moduleName = commandString(cmd, 'moduleName');
      const allowed = new Set([
        'first_layer_inspector', 'spaghetti_detector', 'buildplate_marker_detector',
        'pileup_detector', 'clump_detector', 'printing_monitor', 'airprint_detector',
      ]);
      if (moduleName === undefined || !allowed.has(moduleName)) {
        return { ok: false, error: 'invalid_command' };
      }
      const control = commandBool(cmd, 'control');
      if (control === undefined) return { ok: false, error: 'invalid_command' };
      const print_halt = commandBool(cmd, 'printHalt') ?? false;
      return {
        ok: true,
        payloads: [{
          xcam: {
            sequence_id: '0',
            command: 'xcam_control_set',
            module_name: moduleName,
            control,
            print_halt,
          },
        }],
      };
    }

    case 'setAccessories': {
      const nozzle_diameter = commandF64(cmd, 'nozzleDiameter');
      const nozzle_type = typeof cmd.nozzleType === 'string' ? cmd.nozzleType : undefined;
      if (nozzle_diameter === undefined || nozzle_type === undefined) {
        return { ok: false, error: 'invalid_command' };
      }
      return {
        ok: true,
        payloads: [{
          system: {
            sequence_id: '0',
            command: 'set_accessories',
            accessory_type: 'nozzle',
            nozzle_diameter,
            nozzle_type,
          },
        }],
      };
    }

    case 'getAccessories':
      return {
        ok: true,
        payloads: [{
          system: { sequence_id: '0', command: 'get_accessories', accessory_type: 'none' },
        }],
      };

    case 'getAccessCode':
      return {
        ok: true,
        payloads: [{ system: { sequence_id: '0', command: 'get_access_code' } }],
      };

    case 'skipObjects': {
      const objs = cmd.objList;
      if (!Array.isArray(objs)) return { ok: false, error: 'invalid_command' };
      const list = objs
        .map(v => asI64(v))
        .filter((v): v is number => v !== undefined)
        .map(v => clampInt(v, 0, 999));
      return {
        ok: true,
        payloads: [{ print: { sequence_id: '0', command: 'skip_objects', obj_list: list } }],
      };
    }

    case 'buzzerCtrl': {
      const raw = commandI64(cmd, 'mode');
      if (raw === undefined) return { ok: false, error: 'invalid_command' };
      const mode = clampInt(raw, 0, 10);
      return {
        ok: true,
        payloads: [{
          print: { sequence_id: '0', command: 'buzzer_ctrl', mode, reason: '' },
        }],
      };
    }

    case 'setAirduct': {
      const modeRaw = commandI64(cmd, 'modeId');
      if (modeRaw === undefined) return { ok: false, error: 'invalid_command' };
      const modeId = clampInt(modeRaw, 0, 10);
      const submodeRaw = commandI64(cmd, 'submode') ?? -1;
      const submode = clampInt(submodeRaw, -1, 10);
      return {
        ok: true,
        payloads: [{
          print: { sequence_id: '0', command: 'set_airduct', modeId, submode },
        }],
      };
    }

    case 'ledFlashing': {
      const node = typeof cmd.ledNode === 'string' ? cmd.ledNode : undefined;
      const onRaw = commandI64(cmd, 'onTime');
      const offRaw = commandI64(cmd, 'offTime');
      if (node === undefined || onRaw === undefined || offRaw === undefined) {
        return { ok: false, error: 'invalid_command' };
      }
      const led_on_time = clampInt(onRaw, 50, 5000);
      const led_off_time = clampInt(offRaw, 50, 5000);
      return {
        ok: true,
        payloads: [{
          system: {
            sequence_id: '0',
            command: 'ledctrl',
            led_node: node,
            led_mode: 'flashing',
            led_on_time,
            led_off_time,
            loop_times: 1,
            interval_time: 0,
          },
          user_id: '1234567890',
        }],
      };
    }

    case 'move':
      return { ok: false, error: 'move command not yet implemented' };

    case 'upgradeStart':
    case 'upgradeConfirm':
    case 'upgradeConsistencyConfirm':
      return { ok: false, error: 'upgrade commands are blocked by safety policy' };

    default:
      return { ok: false, error: 'unsupported_command' };
  }
}

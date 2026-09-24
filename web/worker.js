// 브라우저 작업 스레드 — 조립한 게임(port/app/game.ts)을 여기서 돌린다.
//
// 원본은 끝나지 않는 반복문이고 옮긴 코드도 그렇다. 화면 스레드에서 돌리면 페이지가 멈추므로 작업 스레드에서 돌리고,
// 페이지와는 공유 메모리(SharedArrayBuffer)로 주고받는다. 배치는 index.html 과 같아야 한다.
//   Int32 [0] 포트 0x60 의 마지막 바이트 (페이지가 쓴다)
//         [1] BIOS 키 버퍼 머리 (페이지) · [2] 꼬리 (여기) · [8..263] 버퍼 256칸
//         [3] 화면 방식 1 = 모드 X 320x400, 2 = BGI 800x600 · [4] 화면을 낸 횟수 · [5] 잠들 때 쓰는 칸
//   바이트 4096.. 팔레트 256×RGB (8비트) · 8192.. 화면 800×600 (팔레트 번호)
import { setFiles } from "./shim.js";

const W = 800, H = 600;
// 원본의 한 바퀴 시간은 계산 시간과 빈 반복(0x0AC8A, 사람 한 명당 한 번)이다. 옮긴 코드는 계산에 시간이 거의 안 드니
// 둘 다 여기서 기다린다.
// · 계산: 로봇만 있는 robots5_30r_wide_v1(cycles 5000) 첫 6,000바퀴 간격의 중앙값 5.27ms 를 바퀴마다
// · 빈 반복: 한 번 셀 때 10명령(0x0ACAE..0x0ACC6)을 cycles 5000 = 1ms 에 5,000명령으로
// 사람 한 명이면 5.27 + 10 × (2 × 1131 + 1) / 5000 ≈ 9.8ms 이다. 사람 기록 human_live_match1_v1 의 중앙값은 9.9ms 였다.
const WORK_MS = 5.27;
const SPIN_MS = 10 / 5000;
// 메뉴·상점이 빈 반복으로 포트를 읽는 속도. 사람 기록(cycles 12000)에서 잰 1ms 당 바퀴 수(메뉴 약 39, 상점 약 15,
// devlog 119)를 cycles 5000 으로 줄인 값이다. 결과 화면의 대기 반복은 재지 않아서 늦추지 않는다.
const PASS_MS = { menu: 12000 / 5000 / 39, shop: 12000 / 5000 / 15, result: 0, game: 0 }         ;
// 브라우저판은 1P 만 한다고 본다. 맥북 키보드에는 Home·PgUp 이 없어서, 대전 중에 게임이 포트 0x60 을 읽을 때만 왼쪽
// Option(0x38)을 Home(P1 발사 0x47), 왼쪽 Shift(0x2A)를 PgUp(P1 무기 0x49)으로 바꿔 넘긴다 (누름·뗌 둘 다). 게임 코드는
// 원본 그대로 Home·PgUp 을 본다. 메뉴·상점에서는 PgUp·Home 이 다른 뜻이라 바꾸지 않는다. 왼쪽 Control 은 쓰지 않는다 —
// macOS 가 Control+화살표를 데스크톱 전환·Mission Control 로 먼저 가로챈다. 2026-09-24 사용자 결정.
const P1_REMAP                         = { 0x38: 0x47, 0xb8: 0xc7, 0x2a: 0x49, 0xaa: 0xc9 };

self.onmessage = async (e              ) => {
  const { files, sab } = e.data                                                                 ;
  setFiles(files);   // 게임 모듈이 올라오면서 rom/ 을 읽으므로 먼저 넣는다
  const { createGame, Stop, Quit } = await import("../port/app/game.js");
  const ctrl = new Int32Array(sab, 0, 1024);
  const pal = new Uint8Array(sab, 4096, 768);
  const scr = new Uint8Array(sab, 8192, W * H);
  const now = () => performance.now();
  const sleep = (ms        ) => { if (ms > 0) Atomics.wait(ctrl, 5, 0, ms); };

  let lastPresent = 0, clock = now();
  const present = (force = false) => {
    const t = now();
    if (!force && t - lastPresent < 16) return;
    lastPresent = t;
    const { display, dac, raster, vram, vgaRegs } = game;
    const c6 = (v        ) => ((v & 0x3f) * 255 / 63) | 0;
    if (display.mode === "bgi") {
      scr.set(raster.px.subarray(0, W * H));
      // 16색 슬롯이 DAC 64칸에 놓이는 자리: 8 이상은 56..63 (port/lib/palette.ts entryOf)
      for (let s = 0; s < 16; s++) for (let k = 0; k < 3; k++) pal[s * 3 + k] = c6(dac[(s + (s > 7 ? 48 : 0)) * 3 + k]);
      ctrl[3] = 2;
    } else if (display.mode === "modex") {
      const start = ((vgaRegs.get(0x3d5 * 256 + 0x0c) ?? 0) << 8) | (vgaRegs.get(0x3d5 * 256 + 0x0d) ?? 0);
      for (let y = 0; y < 400; y++) for (let x = 0; x < 320; x++)
        scr[y * 320 + x] = vram[(x & 3) * 0x10000 + ((start + y * 80 + (x >> 2)) & 0xffff)];
      for (let i = 0; i < 768; i++) pal[i] = c6(dac[i]);
      ctrl[3] = 1;
    }
    Atomics.add(ctrl, 4, 1);
    if (spk.length) { postMessage({ spk, origin: performance.timeOrigin }); spk = []; }
  };
  // 원본이 쓴 시간만큼 가상 시계를 밀고, 실제 시각보다 앞서면 잔다. 가상 시계가 뒤처져 있으면 catchUp(ms) 까지만 따라잡는다.
  // 게임 루프는 잠에서 늦게 깨는 만큼을 조금 따라잡아야 속도가 맞고, delay 는 따라잡으면 안 된다 — 뒤처진 만큼을 빼면 메뉴의
  // delay(180) 이 짧아져서, 이름 입력을 끝낸 Enter 가 아직 눌린 채로 메뉴에 한 번 더 읽힌다.
  const pace = (ms        , catchUp = 20) => {
    clock = Math.max(clock, now() - catchUp) + ms;
    const ahead = clock - now();
    if (ahead > 2) { present(); sleep(ahead); }
  };
  const pending = () => Atomics.load(ctrl, 1) !== ctrl[2];

  // ── PC 스피커 — sound(hz) 가 켜고 nosound() 가 끈다. 켜고 끈 시각(µs, 이 스레드의 performance.now 기준)을 모아 화면
  // 스레드로 보내면 거기서 파형을 만든다. 한 바퀴 안의 계산은 시간이 안 들므로, 호출 사이 간격은 원본에서 잰 값을 쓴다:
  // 맞을 때의 펄스(object_update 0x0FDB7) 켜짐 4.67µs, 간격 8.58µs (robots 대전 20초, 펄스 3,060개, 0x02930·0x02944
  // 로그포인트). wait·delay 로 기다린 시간은 가상 시계가 이미 반영한다.
  const PULSE_ON_US = 4.67, PULSE_OFF_US = 8.58 - 4.67;
  let spkUs = 0, spk           = [];
  const speaker = (hz        , stepUs        ) => { spkUs = Math.max(spkUs, clock * 1000); spk.push(spkUs, hz); spkUs += stepUs; };

  const game = createGame({
    readRom: (name) => files[name.toUpperCase()] ?? null,
    port: (where) => {
      pace(PASS_MS[where]); present();
      const v = Atomics.load(ctrl, 0) & 0xff;
      return where === "game" ? P1_REMAP[v] ?? v : v;
    },
    shopReadsPort: true,
    kbhit: () => (pending() ? 1 : 0),
    getch: () => {
      while (!pending()) { present(); Atomics.wait(ctrl, 1, ctrl[2], 50); }
      const v = ctrl[8 + (ctrl[2] & 255)]; ctrl[2]++; return v;
    },
    delay: (ms) => { present(true); pace(ms, 0); },
    onIterationTop: () => { pace(WORK_MS); present(); },
    spin: (n) => pace(n * SPIN_MS),
    sound: (hz) => speaker(hz, PULSE_ON_US),
    nosound: () => speaker(0, PULSE_OFF_US),
    clockSeed: Math.floor(Date.now() / 1000),
  });
  try { game.run(); } catch (err) {
    present(true);
    if (err instanceof Quit) { postMessage({ quit: true }); return; }   // LEAVE GAME — 페이지가 끝 화면을 띄운다
    postMessage({ stopped: err instanceof Stop ? err.message : String((err         ).stack ?? err), gaps: [...game.gaps] });
  }
};

// 원본 DZONE.EXE 의 시합 시작 초기화 0x079AE 재구현.
//
// 뜻은 analysis/match_setup.md 에, 바이트 근거는 disasm/addr_0x079AE.md 에 있다.
//
// 원본이 DGROUP 을 직접 고치는 함수라 포트도 같은 주소를 쓴다. 인자는 DGROUP 64KB 를
// 담은 DataView 하나이고, 주소는 전부 원본의 DGROUP 오프셋 그대로다. 그래야 원본이
// 남긴 메모리와 바이트 단위로 댈 수 있다.
// @원본 0x079AE

import { sdiv } from "./borland_long.js";

export const TANK_BASE = 0x43fc, TANK_STRIDE = 0x176;
export const SKILL_BASE = 0x4cc0, SKILL_STRIDE = 0x15;
export const MARKER_BASE = 0x33dc, MARKER_STRIDE = 0x20;
export const CATALOGUE_TANK = 0x740;   // 상점 카탈로그 레코드 5(기본 탱크)의 세 자리
export const PLAYER_COUNT = 0x4d73;

/** 시합이 시작될 때 탱크 레코드 전부를 초기 상태로 만든다 (0x079AE). */
export function matchSetup(ds          )       {
  const n = ds.getInt8(PLAYER_COUNT);
  for (let i = 0; i < n; i++) {
    const t = TANK_BASE + i * TANK_STRIDE;
    const s = SKILL_BASE + i * SKILL_STRIDE;

    // 탱크 레코드의 종류·기량 바이트를 기량 배열로 옮긴다. 두 배열이 여기서 맞춰진다.
    ds.setUint8(s, ds.getUint8(t + 0x00));
    ds.setUint8(t + 0x01, 0);                       // shape_index

    // 이름이 'j' 로 시작하고 두 번째 글자가 'c' 인 탱크만 +0x30 이 0x258 대신 0x3880 이
    // 된다. 이름 문자열은 기량 레코드 +0x01 부터다 (analysis/text_rendering.md).
    if (ds.getUint8(s + 0x02) === 0x63 && ds.getUint8(s + 0x01) === 0x6a) {
      ds.setUint16(t + 0x32, 1, true);
      ds.setUint16(t + 0x30, 0x3880, true);
    } else {
      ds.setUint16(t + 0x32, 0, true);
      ds.setUint16(t + 0x30, 0x258, true);
    }

    ds.setUint16(t + 0x13, 0, true);                // turret_angle

    // 화면 좌표 = 위치를 50 으로 나눈 것. 현재와 직전으로 두 벌 둔다.
    const px = sdiv(ds.getUint32(t + 0x09, true), 50) & 0xffff;
    const py = sdiv(ds.getUint32(t + 0x0d, true), 50) & 0xffff;
    ds.setUint16(t + 0x15, px, true);
    ds.setUint16(t + 0x19, px, true);
    ds.setUint16(t + 0x17, py, true);
    ds.setUint16(t + 0x1b, py, true);

    // 이동·회전 배율이 상점 카탈로그에서 온다.
    ds.setUint16(t + 0x1f, ds.getInt8(CATALOGUE_TANK + 2) & 0xffff, true);   // turn_rate
    ds.setUint16(t + 0x1d, ds.getUint16(CATALOGUE_TANK + 3, true), true);    // move_rate
    ds.setUint8(t + 0x21, ds.getUint8(CATALOGUE_TANK));

    // +0x49 의 바이트 8칸과 +0x51 의 워드 8칸. 1번 칸만 4 와 100 이고 나머지는 0 이다.
    ds.setUint8(t + 0x4a, 4);
    ds.setUint16(t + 0x53, 0x64, true);
    ds.setUint8(t + 0x49, 0);
    ds.setUint16(t + 0x51, 0, true);
    for (let k = 2; k < 8; k++) {
      ds.setUint8(t + 0x49 + k, 0);
      ds.setUint16(t + 0x51 + k * 2, 0, true);
    }

    ds.setUint8(t + 0x34, 1);
    ds.setUint16(t + 0x2a, 0, true);                // 점수 32비트의 상위
    ds.setUint16(t + 0x28, 0, true);                // 점수 32비트의 하위
    for (let k = 0; k < 12; k++) ds.setUint8(t + 0x35 + k, 0);
    for (let k = 0; k < 53; k++) ds.setUint32(t + 0x82 + k * 4, 0, true);
    for (let k = 0; k < n; k++) ds.setUint32(t + 0x15a + k * 4, 0, true);

    // 원본이 이 네 줄을 두 번 쓴다. 두 번째는 아무 일도 하지 않지만 그대로 옮긴다.
    ds.setUint32(t + 0x156, 0, true);
    ds.setUint16(t + 0x172, 0, true);
    ds.setUint32(t + 0x156, 0, true);
    ds.setUint16(t + 0x172, 0, true);
    ds.setUint16(t + 0x174, 0, true);
  }

  // 표시자 1·2 의 32비트 누적값을 지운다. 그 둘을 굴리는 곳은 0x1229C 다.
  ds.setUint32(MARKER_BASE + 1 * MARKER_STRIDE + 0x18, 0, true);
  ds.setUint32(MARKER_BASE + 2 * MARKER_STRIDE + 0x18, 0, true);
}

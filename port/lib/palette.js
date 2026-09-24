// 원본 DZONE.EXE 의 라운드 팔레트 설정 0x13C52 재구현.
//
// 뜻은 analysis/round_palette.md 에, 바이트 근거는 disasm/addr_0x13C52.md 에 있다.
// 메인 게임 루프의 맨 위에서 화면 모드를 바꾼 직후에 불리므로 라운드마다 한 번 돈다.
//
// 인자는 DGROUP 64KB 를 담은 DataView 하나이고 주소는 원본의 DGROUP 오프셋 그대로다.
// @원본 0x13C52 0x049FB

export const BASE_PALETTE = 0x1d4c;   // 64엔트리 × 3바이트. DAC 한 칸이 0..63 이다.
export const TEAM_TABLE = 0x1e0c;     // 6색 × 3바이트. 편 갈라 칠할 때 쓰는 표.
export const SLOT_MAP = 0x126f;       // 플레이어 p 가 쓰는 팔레트 슬롯
export const COLOUR_CACHE = 0x33ac;   // 보이는 16색의 RGB 사본 (3바이트 × 16)
export const TEAM_FLAG = 0x4d65, ROTATION = 0x4d69, PLAYER_COUNT = 0x4d73;

const i16 = (v        )         => (v << 16) >> 16;

// 슬롯 16개가 64칸짜리 DAC 에 놓이는 자리. 8 이상은 56..63 으로 간다 — 16색 EGA 배치다.
function entryOf(slot        , who        )         {
  const e = slot + (slot > 7 ? 48 : 0);
  if (e < 0 || e > 63) {
    throw new RangeError(`${who}: 슬롯 ${slot} 이 DAC 64칸 밖의 ${e} 를 가리킨다`);
  }
  return e;
}

/**
 * 라운드가 시작될 때 DAC 64칸에 실을 팔레트를 만들고, 보이는 16색을 DGROUP 에 적어 둔다.
 *
 * 원본은 만든 192바이트를 INT 10h AX=1012h 로 그대로 DAC 에 싣는다. 그 버퍼가 스택의
 * 지역 변수라 밖에서 볼 수 없으므로 여기서는 돌려준다. 원본이 남기는 것과 댈 수 있는
 * 것은 DGROUP 0x33AC 의 16색 사본이고, 이 함수가 고치는 칸은 전부 그 16 안에 든다.
 */
export function roundPalette(ds          )             {
  const pal = new Uint8Array(192);
  for (let k = 0; k < 192; k++) pal[k] = ds.getUint8(BASE_PALETTE + k);

  // 곧 덮어쓸 여섯 슬롯의 원래 색을 따로 둔다. 엔트리 1, 2, 58, 59, 60, 62 인데
  // 이것이 DS:0x126F 의 앞 여섯 슬롯(11, 1, 10, 12, 14, 2)을 오름차순으로 늘어놓은 것이다.
  const saved = new Uint8Array(18);
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < 6; p++) {
      const e = 1 + p + (p > 1 ? 55 : 0) + (p === 5 ? 1 : 0);
      saved[p * 3 + c] = pal[e * 3 + c];
    }
  }

  const n = ds.getInt8(PLAYER_COUNT);
  if (ds.getUint8(TEAM_FLAG) !== 0) {
    const team = new Uint8Array(18);
    for (let k = 0; k < 18; k++) team[k] = ds.getUint8(TEAM_TABLE + k);

    // 순열은 인원수로 갈린다. 짝수 셋만 처리하는 갈래가 있다.
    // ⚠ 6인 갈래가 칸 7개짜리 배열에 1..6 을 쓴다. 원본은 6칸 지역 변수의 한 칸 뒤까지
    //   쓰는데 그 자리가 안 쓰는 여유 바이트라 아무 일도 안 난다.
    const perm = new Uint8Array(7);
    const count = ds.getUint8(PLAYER_COUNT);
    if (count === 2) perm[1] = 3;
    else if (count === 4) { perm[1] = 1; perm[2] = 3; perm[3] = 4; }
    else if (count === 6) for (let k = 0; k < 6; k++) perm[k + 1] = k + 1;
    else {
      // 인원수가 셋 중 어느 것도 아니면 원본은 안 채워진 스택을 순열로 읽는다. 그러면
      // 답이 입력의 함수가 아니게 된다 — 같은 입력에 앞선 호출만 바꿔 세 번 재 보니 셋
      // 다 달랐다 (goldens/setup_vectors_v1 의 oddCountHistory). 맞힐 수 없으므로 여기서
      // 크게 실패한다.
      throw new RangeError(
        `roundPalette: 편 갈래에 인원수 ${count} 은 2·4·6 중 어느 것도 아니다. ` +
        `원본은 여기서 안 채워진 스택을 순열로 읽으므로 답이 입력만으로 정해지지 않는다.`);
    }

    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const e = entryOf(ds.getInt8(SLOT_MAP + p), "roundPalette(편)");
        pal[e * 3 + c] = team[perm[p] * 3 + c];
      }
    }
  } else {
    // 여섯 탱크의 원래 색을 여섯 슬롯 사이에서 돌린다. 얼마나 돌릴지는 dzone.key 의
    // 한 바이트가 정한다. rom/DZONE.KEY 에서 그 값이 0 이라 3 칸 돌아간다.
    const rot = ds.getInt8(ROTATION);
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const k = i16(p + rot + 3) % 6;   // idiv 의 나머지 — 부호는 나뉘는 쪽을 따른다
        if (k < 0) {
          throw new RangeError(
            `roundPalette: 돌림값 ${rot} 이 음수 색인 ${k} 를 만든다. ` +
            `원본은 여기서 18바이트 지역 변수 앞의 스택을 읽는다.`);
        }
        const e = entryOf(ds.getInt8(SLOT_MAP + p), "roundPalette(돌림)");
        pal[e * 3 + c] = saved[k * 3 + c];
      }
    }
  }

  for (let i = 0; i < 16; i++) {
    const e = (i + (i > 7 ? 1 : 0) * 48) & 0xff;
    for (let c = 0; c < 3; c++) ds.setUint8(COLOUR_CACHE + i * 3 + c, pal[e * 3 + c]);
  }
  return pal;
}

// ── 0x049FB: 파일 앞 768바이트를 DAC 일괄 적재 BIOS 호출로 넘긴다 ──────────
//
// 바이트 근거는 disasm/addr_0x049FB.md. roundPalette(0x13C52)와 달리 아무 계산도 안
// 하고, 파일을 한 바이트씩 768번 읽어(fgetc) 스택 버퍼에 담은 다음 INT 10h AX=1012h
// (BX=0, CX=0x100 — VGA BIOS 의 "DAC 256칸 일괄 설정")로 그 버퍼를 넘긴다. 부르는
// 곳이 파일 이름을 인자로 준다 (0x054E6/0x05666 이 "dzone.gda", 0x065F9 가 "shop.gda").
// 함수 안에 박힌 문자열은 "rb"(DGROUP 0x21AF) 하나다.
//
// ⚠ 확인된 것은 여기까지다 — "이 함수가 파일 앞 768바이트를 AX=1012h 로 넘긴다".
//   그 768바이트가 무엇인지는 다른 물음이고 1단계 밖이다. DAC 한 칸은 0..63 인데
//   rom/DZONE.GDA 의 앞 768바이트에는 0x40 이상 값이 12개 있어(0xFF 포함) 곧바로
//   팔레트라고 부를 수 없다. .GDA 앞부분의 형식은 docs/capture_backlog.md 로 넘겼다.
//   정답표도 "장치에 넘긴 바이트" 까지만 판정한다 (CLAUDE.md 1단계 경계).
//
// fgetc 가 파일 끝을 지나면 -1(AX=0xFFFF)을 돌려주고 원본은 `mov [bp+si-0x300], al`
// 로 그 하위 바이트 0xFF 를 버퍼에 넣는다. hold-short-file(dzone.key, 64바이트)이
// 이것을 원본에 물어 확인했다.
//
// (이 아래는 원본 0x049FB. 파일 맨 위 @원본 줄이 이 파일의 주소를 다 든다.)

const DAC_BLOCK_BYTES = 0x300;   // 256칸 × RGB 3바이트. int 0x10 의 cx = 0x100 이 칸 수.

                                 
                                        
             
                                                 
                   
                                           
                                                
  

/**
 * 원본 0x049FB 를 옮긴 것. 파일 바이트를 주면 성공 경로, null 이면 fopen 실패 경로.
 *
 * 디스어셈블 직역이다. 768바이트를 한 바이트씩 fgetc 로 읽어(파일이 짧으면 끝을 지나
 * 0xFF) 스택 버퍼에 담고, INT 10h AX=1012h 로 넘긴다. 버퍼가 원본에서는 스택 지역
 * 변수라 밖에서 못 보므로 여기서는 돌려준다 (roundPalette 와 같은 처리).
 *
 * @param file  파일 전체 바이트, 또는 fopen 실패면 null.
 */
export function loadPaletteFromFile(file                   )                    {
  if (file === null) return { ax: 1 };   // 0x4A16 분기: 파일도 안 닫고 ax=1 로 나감

  const dac = new Uint8Array(DAC_BLOCK_BYTES);
  for (let si = 0; si < DAC_BLOCK_BYTES; si++) {
    dac[si] = si < file.length ? file[si] : 0xff;   // fgetc EOF → -1 → al = 0xFF
  }
  return { ax: 0, dac, bios: { ax: 0x1012, bx: 0, cx: 0x100 } };
}

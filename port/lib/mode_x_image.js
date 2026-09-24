// 원본 DZONE.EXE 의 Mode X 이미지 적재기 재구현.
//
//   0x0488F  imageRedrawWindow320x400   세로 창 하나를 파일에서 다시 읽어 보이는 페이지에 그린다
//   0x04A58  imageDrawRle320x400        파일 전체를 풀어 400줄을 그리고 DGROUP 0x4DA4 표를 만든다
//   0x04BD9  imageLoadToSecondPage      팔레트를 DAC 에 넣고 날것 400줄을 둘째 페이지에 그린다
//
// 셋 다 같은 화면 방식(언체인드 Mode X 320x400, 한 바이트 한 픽셀, 오프셋 y*0x50 + x/4,
// 평면 x&3, VGA 시퀀서 색인 2 = Map Mask)을 쓴다. 인코딩은 갈린다:
//   - 0x0488F, 0x04A58 은 0x01-이스케이프(바이트가 1 이면 다음 둘이 개수·색).
//   - 0x04BD9 는 **이스케이프가 없다** — 바이트 하나가 곧 한 픽셀이다. 진짜 raw 다.
//     (`cwde` 도 없고, 줄 끝 조건이 `jge` 가 아니라 `jl` 이다.)
//
// 바이트 근거는 disasm/addr_0x0488F.md, disasm/addr_0x04A58.md, disasm/addr_0x04BD9.md,
// 배경은 analysis/mode_x_image_loaders.md 에 있다.
//
// ── 이름이 "raw" 인데 실제로는 ──────────────────────────────────────────────
// 이 함수는 순수 raw(한 바이트 한 픽셀)가 아니다. 형제 0x04A58("rle")과 **똑같은**
// 0x01-이스케이프 인코딩을 푼다: 바이트가 1 이면 다음 두 바이트가 (개수, 색)이고 그
// 색을 개수만큼 찍는다. 그 밖의 바이트는 그 자체가 한 픽셀의 색이다. 두 함수의 진짜
// 차이는 인코딩이 아니라, 0x04A58 은 파일을 처음부터 다 풀며 DGROUP 0x4DA4 의 오프셋
// 표를 **만들고**, 0x0488F 은 그 표로 파일 안을 **찾아가** 세로 창만 다시 그린다는
// 것이다 (가로 뒤집기 인자도 있다). analysis 문서의 "0x0488F 은 한 바이트 한 픽셀"
// 은 정적 분석만 한 상태의 단순화다.
//
// ── DGROUP 0x4DA4 표 ──────────────────────────────────────────────────────
// 32비트 리틀엔디언 파일 오프셋의 표. 낮은 워드가 0x4DA4+k, 높은 워드가 0x4DA6+k,
// 간격 4, 색인 k4 = ((0x190 - vTop32) / 2 & 0xFFFF) << 2. 화면 두 줄에 항목 하나다.
// 읽은 값에 0x300(768바이트 팔레트 머리)을 더해 그 자리로 fseek 한다. 이 표는 형제
// 0x04A58 이 같은 이미지를 풀며 채운다 — 안 채워져 있으면(파일 상태의 DGROUP 은 0)
// 0x300 으로 찾아가 파일 본문 첫머리부터 푼다.
//
// @원본 0x0488F 0x04A58 0x04BD9

import { sdiv, u32, i32 } from "./borland_long.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

/**
 * 0x0488F 이 바깥에 시키는 일. 원본은 fopen(0x02D81)·fseek(0x02F35)·fgetc(0x030CD)·
 * fclose(0x02AC8) 와, 픽셀마다 `out 0x3C4, ax`(Map Mask) + `mov es:[di], bl` 를 한다.
 * 파일 넷은 status.tsv 에서 제외-라이브러리다 — 여기서 인터페이스로만 받는다.
 */
                                
                                                                
                 
                                                    
                                         
                                                                  
                           
                    
                          
                                                                       
                                                            
 

// 원본은 `mov ax,[bx+0x4da6]` / `mov dx,[bx+0x4da4]` 로 DGROUP 을 경계 없이 읽는다
// (bx = k4 는 16비트라 표 200개를 넘을 수 있다). 그래서 표를 잘라 두지 않고 세그먼트를
// 통째로 받아 16비트로 접힌 주소로 읽는다.
function dgroupWord(dgroup            , off        )         {
  return dgroup[off & 0xffff] | (dgroup[(off + 1) & 0xffff] << 8);
}

/**
 * 픽셀 하나의 평면과 오프셋. 원본 0x4952~0x495B / 0x49A5~0x49B1 / 0x4C51~0x4C5D.
 * `base` 는 세그먼트 차이다 — 0x0488F·0x04A58 은 es=0xA000 이라 0, 0x04BD9 는
 * es=0xA800 이라 0x8000 (VGA 개구부에서 0x8000 바이트 안쪽 = 둘째 페이지).
 */
function writePixel(
  host               , curRow        , screenX        , colour        , base = 0,
)       {
  const off = u16(0x50 * u16(curRow));                 // mul dx (ax 만 쓴다)
  const di = u16(off + ((screenX & 0xffff) >>> 2));    // add ax, cx (16비트) ; shr 는 논리
  host.plot(screenX & 3, base + di, colour & 0xff);    // and cl,3 ; ah=1<<cl ; es:[di]=bl
}

/**
 * 원본 0x0488F 을 옮긴 것. 반환 0 = 그렸다, 1 = fopen 실패.
 *
 * @param dgroup  0x10000 바이트. 0x4DA4 의 오프셋 표를 읽는다. 표는 부르기 전에 형제
 *                0x04A58 이 채워 둔 것이다 (측정 계약과 무관한 런타임 상태).
 * @param vTopLo  [bp+0xc]. 세로 창 위끝 (curRow 시작값). 낮은 워드.
 * @param vTopHi  [bp+0xe]. 위끝 높은 워드 (표 색인 계산에만 쓴다).
 * @param limitLo [bp+8].  세로 창 아래끝. curRow32 > limit32 인 동안만 그린다 (부호 있는 32비트).
 * @param limitHi [bp+0xa].
 * @param mirror  [bp+0x10]. 0 이 아니면 screenX = 0x140 - x (가로 뒤집기). 경계를 안 본다.
 */
export function imageRedrawWindow320x400(
  host               ,
  dgroup            ,
  vTopLo        ,
  vTopHi        ,
  limitLo        ,
  limitHi        ,
  mirror        ,
)         {
  const fp = host.open();
  if (u16(fp) === 0) return 1;                          // or ax,ax ; jne (ax 는 16비트)

  // 표 색인 → 파일 오프셋 → fseek. 0x190 - vTop32 를 부호 있는 long 나눗셈으로 2 로 나눈다.
  const vTop32 = u32(((vTopHi & 0xffff) << 16) | (vTopLo & 0xffff));
  const k4 = u16((u16(sdiv(u32(0x190 - vTop32), 2)) << 2));   // shl ax,1 두 번 (16비트)
  const lo = dgroupWord(dgroup, k4 + 0x4da4);
  const hi = dgroupWord(dgroup, k4 + 0x4da6);
  host.seek(fp, u32((u32((hi << 16) | lo)) + 0x300));   // add dx,0x300 ; adc ax,0

  const limit32 = i32(((limitHi & 0xffff) << 16) | (limitLo & 0xffff));
  let curRow = u16(vTopLo);                             // [bp-6]

  while (i16(curRow) > limit32) {                       // cdq(int16 curRow) 를 limit32 와 부호 비교
    let x = 0;                                          // si
    // `jge` 는 부호 있는 비교다. 개수 바이트가 0x80 이상이면 위에서 si 가 뒤로 가
    // 0xFF85 같은 값이 되는데, 원본은 그것을 -123 으로 보므로 줄을 계속 돈다.
    // 부호 없이 비교하면 65413 이라 여기서 빠져나가 버린다. 정답표는 이 갈림을
    // 못 본다 — rom/DZONE.GDA 안에 바이트 0x01 뒤에 0x80 이상이 오는 자리가 한 곳도
    // 없어서 개수가 음수가 되는 경로를 그 파일로는 못 만든다 (골든 README 참조).
    while (i16(x) < 0x140) {                            // cmp si, 0x140 ; jge
      const b = host.getc(fp) & 0xff;
      if (b === 1) {
        const count = host.getc(fp) & 0xff;
        const colour = host.getc(fp) & 0xff;
        // 원본: al=count ; cwde ; add ax,si (16비트) ; cmp ax,[bp-4] ; jg
        const runEnd = u16(u16(sbyte(count)) + x);
        for (let j = x; i16(runEnd) > i16(j); j = u16(j + 1)) {
          writePixel(host, curRow, mirror !== 0 ? u16(0x140 - j) : j, colour);
        }
        x = u16(x + sbyte(count));                      // add si, ax (ax = cwde(count))
      } else {
        writePixel(host, curRow, mirror !== 0 ? u16(0x140 - x) : x, b);
        x = u16(x + 1);
      }
    }
    curRow = u16(curRow - 1);                           // dec word [bp-6]
  }
  host.close(fp);
  return 0;
}

/**
 * 원본 0x04BD9 을 옮긴 것. 반환 { ret, palette }.
 *   ret     0 = 그렸다, 1 = fopen 실패.
 *   palette 파일 첫머리 768바이트 (fopen 성공 시). 원본은 이것을 `int 0x10` AX=0x1012,
 *           BX=0, CX=0x100 으로 256개 DAC 레지스터에 통째로 넣는다. 포트는 부르는 쪽이
 *           쓰도록 그대로 돌려준다.
 *
 * 형제 둘과 다른 점:
 *   - **이스케이프가 없다.** fgetc 한 바이트가 곧 한 픽셀이다 (`cmp ..,1` 갈래 자체가
 *     없다). 진짜 raw 다.
 *   - 그림을 **둘째 페이지**(es=0xA800, VGA 개구부에서 0x8000 안쪽)에 그린다.
 *   - 팔레트를 읽어 버리지 않고 DAC 에 넣는다.
 *   - 인자가 파일 이름 하나뿐이다 (가로 뒤집기도, 세로 창도, 표도 없다).
 *   - 줄 끝 조건이 `cmp [bp-4],0x140; jl` (형제는 `jge`), 바깥은 `cmp [bp-6],0; jg`.
 *     둘 다 부호 있는 비교이고, curRow(400→1)·x(0→319)가 늘 양수라 부호 없이 봐도
 *     같다 — `cwde` 가 없어서 음수가 생길 자리가 아예 없다.
 */
export function imageLoadToSecondPage(
  host               ,
)                                              {
  const fp = host.open();
  if (u16(fp) === 0) return { ret: 1, palette: null };  // or ax,ax ; jne

  const palette = new Uint8Array(0x300);
  for (let i = 0; i < 0x300; i++) palette[i] = host.getc(fp) & 0xff;  // 768바이트 → DAC

  let curRow = 0x190;                                   // [bp-6] = 400
  while (i16(curRow) > 0) {                             // cmp [bp-6], 0 ; jg (부호 있는)
    let x = 0;                                          // [bp-4]
    while (i16(x) < 0x140) {                            // cmp [bp-4], 0x140 ; jl (부호 있는)
      const b = host.getc(fp) & 0xff;                   // 이스케이프 없음 — 한 바이트 한 픽셀
      writePixel(host, curRow, x, b, 0x8000);           // es=0xA800 → 창 오프셋 +0x8000
      x = u16(x + 1);                                   // inc word [bp-4]
    }
    curRow = u16(curRow - 1);                           // dec word [bp-6]
  }
  host.close(fp);
  return { ret: 0, palette };
}

/**
 * 원본 0x04A58 을 옮긴 것. 반환 0 = 그렸다, 1 = fopen 실패.
 *
 * 형제 0x0488F 과 같은 0x01-이스케이프 인코딩을 풀지만, 파일 첫머리의 768바이트
 * 팔레트를 읽어 버리고 400줄(curRow 0x190→1, 부호 있는 `jle` 로 0 에서 멈춘다)을 전부
 * 그리며, 두 줄마다 그때까지 읽은 파일 바이트 수를 DGROUP 0x4DA4 표에 적는다.
 * 인자는 파일 이름과 가로 뒤집기 깃발뿐이다 (세로 창도 fseek 도 없다).
 *
 * @param dgroup  0x10000 바이트. 이 함수가 0x4DA4 표를 여기에 쓴다. 색인
 *                bx = ((0xC8 - curRow/2) & 0xFFFF) << 2, 그 자리에 32비트 바이트 수.
 * @param mirror  [bp+8]. 0 이 아니면 screenX = 0x140 - x.
 */
export function imageDrawRle320x400(
  host               ,
  dgroup            ,
  mirror        ,
)         {
  const fp = host.open();
  if (u16(fp) === 0) return 1;                          // or ax,ax ; jne

  for (let i = 0; i < 0x300; i++) host.getc(fp);        // 팔레트 768바이트, 버린다

  let bytes = 0;                                        // [bp-0xc:0xe] 32비트 바이트 수
  let curRow = 0x190;                                   // [bp-6] = 400

  while (i16(curRow) > 0) {                             // cmp [bp-6], 0 ; jle (부호 있는)
    // 짝수 줄에서만 표를 쓴다. 원본 0x4AA6: cwd ; idiv 2 ; or dx,dx ; jne (16비트 부호 있는).
    if (i16(curRow) % 2 === 0) {
      const half = (i16(curRow) / 2) | 0;               // cwd ; idiv bx(=2) — 0 쪽으로 자름
      const bx = u16(u16(0xc8 - half) << 2);            // sub bx,ax ; shl bx,1 ; shl bx,1 (16비트)
      dgroup[u16(bx + 0x4da4)] = bytes & 0xff;
      dgroup[u16(bx + 0x4da4 + 1)] = (bytes >>> 8) & 0xff;
      dgroup[u16(bx + 0x4da6)] = (bytes >>> 16) & 0xff;
      dgroup[u16(bx + 0x4da6 + 1)] = (bytes >>> 24) & 0xff;
    }

    let x = 0;                                          // [bp-4]
    while (i16(x) < 0x140) {                            // cmp [bp-4], 0x140 ; jge (부호 있는)
      const b = host.getc(fp) & 0xff;
      if (b === 1) {
        const count = host.getc(fp) & 0xff;
        const colour = host.getc(fp) & 0xff;
        // 원본 0x4B4B: al=count ; cwde ; add ax,[bp-4] (16비트) ; cmp ax,si ; jg
        const runEnd = u16(u16(sbyte(count)) + x);
        for (let si = x; i16(runEnd) > i16(si); si = u16(si + 1)) {
          writePixel(host, curRow, mirror !== 0 ? u16(0x140 - si) : si, colour);
        }
        x = u16(x + sbyte(count));                      // add [bp-4], ax (ax = cwde(count))
        bytes = u32(bytes + 3);                         // add [bp-0xe],3 ; adc [bp-0xc],0
      } else {
        writePixel(host, curRow, mirror !== 0 ? u16(0x140 - x) : x, b);
        x = u16(x + 1);                                 // inc word [bp-4]
        bytes = u32(bytes + 1);                         // add [bp-0xe],1 ; adc [bp-0xc],0
      }
    }
    curRow = u16(curRow - 1);                           // dec word [bp-6]
  }
  host.close(fp);
  return 0;
}

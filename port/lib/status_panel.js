// 원본 DZONE.EXE 0x1261B — 오른쪽 상태 칸에서 사람 하나의 블록을 다시 그린다.
//
//   0x1261B  drawStatusPanelBlock(mode, player)
//
// 바이트 근거는 disasm/addr_0x1261B.md, BGI 껍데기는 analysis/graphics_bgi.md,
// 화면 크기 표는 analysis/arena_layout.md 와 disasm/data_0x1241.md 에 있다.
// 이 함수의 뜻(무슨 블록을 언제 그리는가)은 아래 주석으로 접었다 — disasm 의 note 를
// 따로 옮기지 않는다 (CLAUDE.md: "이미 있는 함수별 해석은 그 함수를 옮기는 작업에서
// 포트 주석으로 접는다").
// @원본 0x1261B
//
// ── 무엇을 그리는가 ────────────────────────────────────────────────────────────
// 인자 둘: mode 는 어느 부분을 다시 그릴지 고르고(bp+6), player 는 몇 번째 사람인지다
// (bp+8). 자기 반복도 점프 표도 없다. 길이는 되풀이되는 그리기다.
//
//   mode 0        아래 전부 + 테두리: setfillstyle 뒤 bar 로 블록을 지우고 윤곽과 칸막이
//   mode 0 또는 1  무기 약칭. 게임 자체 글꼴 렌더러 0x136ED 로, 그 탱크가 고른 인벤토리
//                  칸이 가리키는 상점 카탈로그 레코드에서 그린다:
//                     item = tank[p].+0x49[ tank[p].+0x34 ]
//                     drawString(W-35, di-14, 0x608 + item*0x3D, colour)
//   mode 0 또는 2  게이지 1: 값 +0x22 를 400 만점으로, 캐시 +0x24
//   mode 0 또는 3  게이지 2: 값 +0x26 을 100 만점으로, 캐시 +0x27
//
// 게이지는 값이 캐시와 같고 mode 가 0 이 아니면 곧바로 나간다. 그래서 메인 루프가
// 프레임마다 거는 mode 2/3 호출은 흔한 프레임에서 아무것도 안 한다. 값이 바뀌었으면
// 옛 높이와 새 높이 사이 띠를 색 8 로 지우고 새 부분을 그린 뒤 캐시를 갱신한다.
//
// ── 화면 기하 ────────────────────────────────────────────────────────────────
// H 는 화면 높이, W 는 화면 너비. 둘 다 DGROUP 0x1241 의 표를 화면 모드 바이트 0x4D79 로
// 보폭 4 로 찾아 읽는다 (0x1241 = maxX, 0x1243 = maxY). 이 함수 안에 박힌 화면 상수는
// 하나도 없다 — 0x4D79 를 66번, 0x1241 표를 64번 다시 읽는다.
//
//   rowh = (H - 1) / ntanks            # 사람 수만큼 칸을 나눈다 (ntanks = 0x4D73)
//   di   = player * rowh + 19          # 그 칸의 위 모서리 (세로 좌표)
//   corr = 2 * ((player+1) / ntanks) * (player+1) / 3
//   hv   = rowh + corr - 26            # 막대가 쓰는 세로 길이 (16비트로 접힌 낮은 워드)
//
// corr 는 마지막 사람만 0 이 아니다 (그때 2*ntanks/3). 맨 아래 칸만 조금 길어지는데
// 일부러인지 흠인지는 확정 안 됨 (disasm 의 uncertain).
//
// 색은 DGROUP 0x126F 의 그 사람 팔레트 슬롯이다. 다만 그 탱크의 +0x02 가 켜져 있으면
// (파괴됨) 색 7(회색)로 그린다 — 그래서 파괴 처리 0x0F3CA 가 이 함수를 부른다.
//
// ── 좌표 계산의 세부 ─────────────────────────────────────────────────────────
// 전부 16비트 산술이다. `cwde`/`cdq` 로 보이는 바이트는 실제로는 `cbw`/`cwd` 다 (16비트
// DGROUP 프로그램, text.ts 와 같은 규칙). 그래서 sbyte/i16/u16 으로 접는다.
//
// BGI line/bar 껍데기는 인자 넷을 스택에서 ax/bx/cx/dx 로 옮긴다. C 는 오른쪽 인자부터
// push 하므로 프로그램 순서로 마지막 push 가 ax(첫 인자)다. 아래 host.line/host.bar 의
// 인자는 원본의 push 를 거꾸로 뒤집은 것이고, 골든이 껍데기 진입에서 ax/bx/cx/dx 를
// 그대로 잡아 판정한다.
//
// 게이지 막대 높이는 Borland 32비트 헬퍼로 구한다:
//   si = di + FLXDIV( FLXMUL(h32, scale - X), scale )      (낮은 16비트만)
// h32 는 hv 를 32비트로 부호 확장한 것이다 ([bp-4]:[bp-6]).

import { lmul, sdiv, u32 } from "./borland_long.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

/** 16비트 부호 있는 나눗셈의 몫 (원본 `cwd; idiv bx`). 우리 입력 범위에서 AX 를 안 넘는다. */
const idiv16 = (a        , b        )         => i16(Math.trunc(i16(a) / i16(b)));

/** DGROUP 을 통째로 담은 64KiB 배열에서 16비트 리틀엔디언 워드를 읽는다 (오프셋 16비트로 접음). */
function dgw(dg            , off        )         {
  const o = u16(off);
  return dg[o] | (dg[u16(o + 1)] << 8);
}

/** 그리기 호출을 순서대로 받는 상대. 원본의 BGI 진입점과 게임 글꼴 렌더러에 대응한다. */
                            
                                              
                                                      
                                              
                                 
                                                    
                                                             
                               
                                                            
                                                                                
                                                                               
                                                                         
 

/** si = di + FLXDIV(FLXMUL(h32, sub16), scale) 의 낮은 16비트. sub16 = u16(scale - X). */
function gaugeLevel(di        , h32        , sub16        , scale        )         {
  const product = lmul(h32, u32(i16(sub16))); // FLXMUL: dx:ax(h32) * cx:bx(부호 확장한 sub)
  const q = sdiv(product, scale); // FLXDIV: 몫을 0 쪽으로 자름
  return u16(di + (q & 0xffff)); // add dx, ax (16비트)
}

/**
 * 게이지 하나를 그린다. 게이지 1(0x1290C)과 게이지 2(0x12C70)는 구조가 같다 —
 * rX 상수만 게이지 2 가 +15 만큼 다르고(xoff), 만점과 필드 너비가 다르다. subCache/
 * subValue 는 원본이 이미 접은 `u16(scale - 캐시)` / `u16(scale - 값)` 이다.
 */
function drawGauge(
  host           , di        , h32        , maxX        ,
  scale        , xoff        , subCache        , subValue        ,
)       {
  const rx = (k        )         => u16(maxX + u16((k + xoff) & 0xffff));

  host.setcolor(8);
  let si = gaugeLevel(di, h32, subCache, scale);
  host.line(rx(-29), u16(si - 1), rx(-25), u16(si - 1));
  host.line(rx(-30), si, rx(-24), si);
  host.line(rx(-30), u16(si + 1), rx(-24), u16(si + 1));
  host.line(rx(-30), u16(si + 2), rx(-24), u16(si + 2));
  host.line(rx(-23), si, rx(-23), u16(si + 2));
  host.setcolor(7);
  host.line(rx(-27), u16(si - 1), rx(-27), u16(si + 2));
  host.setcolor(0);
  host.line(rx(-26), u16(si - 1), rx(-26), u16(si + 2));

  host.setcolor(15);
  si = gaugeLevel(di, h32, subValue, scale);
  host.line(rx(-29), u16(si - 1), rx(-25), u16(si - 1));
  host.line(rx(-30), si, rx(-24), si);
  host.line(rx(-30), u16(si + 1), rx(-24), u16(si + 1));
  host.setcolor(0);
  host.line(rx(-30), u16(si + 2), rx(-24), u16(si + 2));
  host.line(rx(-23), si, rx(-23), u16(si + 2));
}

/**
 * 원본 0x1261B. dg 는 DGROUP 을 통째로 담은 64KiB 배열이고, 표(0x1241)·팔레트(0x126F)·
 * 화면 모드(0x4D79)·사람 수(0x4D73)·탱크 레코드(0x43FC + player*0x176)를 그 안에서 읽는다.
 * 게이지 캐시 필드(+0x24 워드, +0x27 바이트)에 되쓰기도 한다.
 *
 * frameBp — 이 호출의 BP (게임 루프에서 0xFFDE). 스택이 DGROUP 안(SS=DS)이라, 주면 line 을 부를 때마다 BGI 가
 * 남기는 워드를 DGROUP 에 쓴다. sub sp,6 + si·di 뒤에 인자 넷과 far 복귀 주소를 쌓으면 line 껍데기의 push bp 가
 * [bp-0x18] 이고, 그 0x0E 아래 [bp-0x26] 에 드라이버 호출 입구(이미지 0x16390 `push si`)가 드라이버 함수 번호 0x000C
 * 를 민다. 오토파일럿이 초기화하지 않고 읽는 칸 0xFFB8 이 그 자리다 (devlog 122 — 원본에서 게이지를 다시 그린 게임
 * 루프 호출은 모두 0x000C 로 끝났고, 값이 그대로라 안 그린 호출은 그 칸을 안 건드렸다).
 */
export function drawStatusPanelBlock(
  panelHost           , dg            , mode        , player        , frameBp         ,
)       {
  const host            = frameBp === undefined ? panelHost : {
    ...panelHost,
    line: (x1, y1, x2, y2) => {
      panelHost.line(x1, y1, x2, y2);
      const a = (frameBp - 0x26) & 0xffff; dg[a] = 0x0c; dg[(a + 1) & 0xffff] = 0;
    },
  };
  // 원본은 두 인자를 `mov al, byte ptr [bp+6/8]` / `cmp byte ptr` 로 언제나 바이트로만
  // 읽는다. 부르는 쪽(예: 0x121E2 change-weapon)이 상위 바이트에 imul 찌꺼기를 남긴 워드를
  // 밀어도 무해한 것은 이 자름 때문이다. 그 자름을 여기 둔다 — 부르는 쪽마다 기억할
  // 필요가 없게.
  mode = mode & 0xff;
  player = player & 0xff;

  const p = sbyte(player);
  const pp176 = u16(i16(p) * 0x176); // cbw; imul dx,0x176 — 탱크 레코드 보폭

  let colour = dg[u16(p + 0x126f)]; // [bx + 0x126f], bx = 부호 확장한 player
  if (dg[u16(pp176 + 0x43fe)] !== 0) colour = 7; // +0x02 파괴 플래그 → 회색

  const gi = u16(sbyte(dg[0x4d79]) * 4); // 0x4D79 * 4 = 표 색인
  const maxX = dgw(dg, u16(gi + 0x1241));
  const maxY = dgw(dg, u16(gi + 0x1243));
  const ntanks = sbyte(dg[0x4d73]);

  const rowh = idiv16(u16(maxY - 1), ntanks);
  const di = u16(u16(i16(rowh) * i16(p)) + 0x13); // rowh*player + 19

  // corr = 2 * ((player+1)/ntanks) * (player+1) / 3
  const q1 = idiv16(u16(p + 1), ntanks);
  const c2 = u16(i16(q1) * 2); // shl ax, 1
  const c3 = u16(i16(c2) * i16(u16(p + 1))); // imul dx, dx = player+1
  const corr = idiv16(c3, 3);

  // 원본은 rowh 를 여기서 다시 나눈다. 같은 값이다.
  const hv = u16(u16(idiv16(u16(maxY - 1), ntanks) + corr) + 0xffe6); // rowh + corr - 26
  const h32 = u32(i16(hv)); // cwd/cdq — [bp-4]:[bp-6]

  const rx = (k        )         => u16(maxX + u16(k & 0xffff));
  const dh = u16(di + hv); // di + [bp-6] (낮은 워드끼리 16비트 덧셈)

  // ── 프레임 블록 (mode 0) ──────────────────────────────────────────────────
  if (mode === 0) {
    host.setfillstyle(1, 7);
    host.setcolor(0);
    host.line(rx(-26), u16(di + 1), rx(-26), u16(dh + 3));
    host.line(rx(-11), u16(di + 1), rx(-11), u16(dh + 3));
    const e = player === 0 ? -18 : -17; // 0x1274D 갈래: cmp [bp+8],0
    host.line(rx(-37), u16(di + e), u16(maxX - 1), u16(di + e));
    host.setcolor(7);
    if (player !== 0) {
      host.bar(rx(-38), u16(di - 19), u16(maxX - 1), u16(di - 18));
    }
    host.line(rx(-27), di, rx(-27), u16(dh + 2));
    host.line(rx(-12), di, rx(-12), u16(dh + 2));
  }

  // ── 약칭 블록 (mode 0 또는 1) ─────────────────────────────────────────────
  if (mode === 0 || mode === 1) {
    host.setfillstyle(1, 8);
    host.bar(rx(-35), u16(di - 14), rx(-5), u16(di - 6));
    const sel = sbyte(dg[u16(pp176 + 0x4430)]); // tank[p].+0x34
    const item = sbyte(dg[u16(u16(pp176 + sel) + 0x4445)]); // tank[p].+0x49[sel]
    const strptr = u16(u16(i16(item) * 0x3d) + 0x608); // 0x608 + item*0x3D
    host.drawString(rx(-35), u16(di - 14), strptr, colour & 0xff);
  }

  // ── 게이지 1 (mode 0 또는 2), 값 +0x22 / 캐시 +0x24, 400 만점 ─────────────
  if (mode === 0 || mode === 2) {
    const value = dgw(dg, u16(pp176 + 0x441e));
    const cache = dgw(dg, u16(pp176 + 0x4420));
    if (!(value === cache && mode !== 0)) {
      drawGauge(host, di, h32, maxX, 0x190, 0, u16(0x190 - cache), u16(0x190 - value));
      const v = dgw(dg, u16(pp176 + 0x441e)); // 다시 읽어서
      dg[u16(pp176 + 0x4420)] = v & 0xff;
      dg[u16(pp176 + 0x4421)] = (v >> 8) & 0xff;
    }
  }

  // ── 게이지 2 (mode 0 또는 3), 값 +0x26 / 캐시 +0x27, 100 만점 (바이트) ─────
  if (mode === 0 || mode === 3) {
    const value8 = dg[u16(pp176 + 0x4422)] & 0xff;
    const cache8 = dg[u16(pp176 + 0x4423)] & 0xff;
    if (!(value8 === cache8 && mode !== 0)) {
      // 게이지 2 는 캐시·값 바이트를 빼기 전에 부호 확장한다 (cbw).
      drawGauge(
        host, di, h32, maxX, 0x64, 15,
        u16(0x64 - sbyte(cache8)), u16(0x64 - sbyte(value8)),
      );
      dg[u16(pp176 + 0x4423)] = value8 & 0xff;
    }
  }
}

// 원본 DZONE.EXE 의 언체인드 Mode X 진입 재구현.
//
//   0x040B4  enterModeX   BIOS 모드 0x13 을 켠 뒤 VGA 레지스터를 직접 건드려
//                         320x400 4평면 언체인드로 바꾸고, 인자가 고른 화면
//                         페이지를 0 으로 채운다
//
// 바이트 근거는 disasm/addr_0x040B4.md, 배경은 analysis/video_modes_and_line_drawing.md
// 와 analysis/mode_x_image_loaders.md 에 있다. 부르는 곳 셋(주 함수 0x04DC7, 메뉴
// 0x054AD, 상점 0x05FB3)이 전부 인자 3 을 넘긴다.
//
// 이 함수는 순수 계산이 아니라 VGA 칩과 화면 메모리를 만지는 함수다. 그래서 자기가
// 값을 만들지 않고 바깥(host)에 시키는 일의 순서를 그대로 옮긴다 —
//   - int86 으로 INT 0x10 (BIOS 모드 설정)
//   - VGA 레지스터를 포트로 읽고(in) 고쳐서 다시 쓴다(out). 다시 쓰는 값은 읽은 값에
//     매여 있으므로 host 가 준 in 값으로 계산한다. 이것이 정답표가 판정하는 지점이다.
//   - 화면 세그먼트(0xA000 / 0xA800)의 오프셋 하나하나에 0 을 쓴다
//
// 레지스터 색인·마스크·차례는 disasm/addr_0x040B4.md 의 out/in 명령 그대로다.
// 색인을 잘못 옮기면 tools/check_claims.py 의
// mode-x-setup-writes-the-documented-vga-registers 에서도 깨진다.
//
// @원본 0x040B4 0x04206

const u16 = (v        )         => v & 0xffff;

/**
 * 0x040B4 이 바깥에 시키는 일. 원본은 라이브러리 int86(0x02158)·outport(0x0145A)와
 * `out`/`in` 명령, 그리고 `mov es:[si], 0` 으로 이 다섯 가지를 한다. 둘 다
 * status.tsv 에서 제외-라이브러리다 — 여기서 인터페이스로만 받는다.
 */
                            
                                                                     
                          
                                   
                                          
                                            
                            
                                                          
                                          
                                                            
                                                   
 

/**
 * 원본 0x040B4 을 옮긴 것. arg 는 [bp+6] 의 하위 바이트로, 지울 페이지를 고르는
 * 비트다 (모드 번호가 아니다). 비트 0 → 0xA000 블록, 비트 1 → 0xA800 블록.
 * 원본이 `== 1 || == 3` 과 `== 2 || == 3` 으로 검사하므로 그 값들에서만 지운다.
 *
 * 지우는 반복은 원본 그대로다. si 가 0x8000 에서 시작해 **먼저 1 을 빼고**, 0 이
 * 되면 멈춘다. 그래서 오프셋 0x8000 과 0 은 안 지워진다 — 원본의 흠이지 여기서
 * 잘라낸 것이 아니다. 한 블록에 0x7FFF 바이트를 채운다.
 */
export function enterModeX(arg        , host           )       {
  host.int10(0x13);

  // 0x3C4 색인 4 (Sequencer Memory Mode): chain-4 해제, 확장 메모리 켬
  host.outb(0x3c4, 4);
  host.outb(0x3c5, (host.inb(0x3c5) & 0xf7) | 0x04);
  // 0x3CE 색인 5 (Graphics Mode): odd/even 해제
  host.outb(0x3ce, 5);
  host.outb(0x3cf, host.inb(0x3cf) & 0xef);
  // 0x3CE 색인 6 (Miscellaneous): chain odd/even 해제
  host.outb(0x3ce, 6);
  host.outb(0x3cf, host.inb(0x3cf) & 0xfd);
  // 0x3C4 색인 2 (Map Mask): 워드 0x0F02 로 평면 넷 다 켬
  host.outw(0x3c4, 0x0f02);

  const sel = arg & 0xff;
  if (sel === 1 || sel === 3) {
    for (let si = u16(0x8000 - 1); si !== 0; si = u16(si - 1)) host.clearByte(0xa000, si);
  }
  if (sel === 2 || sel === 3) {
    for (let si = u16(0x8000 - 1); si !== 0; si = u16(si - 1)) host.clearByte(0xa800, si);
  }

  // 0x3D4 색인 9 (Maximum Scan Line): 배주사 해제 → 줄이 400개가 된다
  host.outb(0x3d4, 9);
  host.outb(0x3d5, host.inb(0x3d5) & 0xe0);
  // 0x3D4 색인 0x14 (Underline Location): 더블워드 주소 해제
  host.outb(0x3d4, 0x14);
  host.outb(0x3d5, host.inb(0x3d5) & 0xbf);
  // 0x3D4 색인 0x17 (Mode Control): 바이트 주소 켬
  host.outb(0x3d4, 0x17);
  host.outb(0x3d5, host.inb(0x3d5) | 0x40);
}

// ── 0x04206: 텍스트 모드로 되돌린다 ────────────────────────────────────
//
// 바이트 근거는 disasm/addr_0x04206.md. enterModeX(0x040B4)의 처음 여섯 명령과 같은
// 꼴인데 REGS 블록 [bp-0x10] 첫 워드에 두는 값이 0x13 이 아니라 3 이고, 호출 뒤에
// 아무것도 안 온다. 모드 3 은 80x25 컬러 텍스트라 DOS 화면으로 나가는 길이다. 인자도
// 갈림도 색인도 없다. 부르는 곳 둘(0x09FAD 주 종료, 0x13EF1)이 인자 없이 부른다.
//
// 원본은 `sub sp,0x10` 으로 16바이트를 잡고 첫 워드에만 3 을 쓴다 — 나머지 14바이트는
// 스택 찌꺼기라 이 함수가 정한 값이 아니다. 판정한 것은 화면이 아니라 "int86 에
// REGS.ax=3 을 넘겼나" 다 (CLAUDE.md 1단계 경계). 정답표는 goldens/palette_file_vectors_v1.
//
// (이 아래는 원본 0x04206. 파일 맨 위 @원본 줄이 이 파일의 주소를 다 든다.)

/**
 * 원본 0x04206 을 옮긴 것. REGS.ax = 3 으로 INT 0x10 을 부르는 것이 전부다.
 * ModeXHost.int10 이 REGS.ax = ax 로 두고 INT 0x10 을 부른다 — 원본과 같다.
 * int10 하나만 쓰므로 인자를 그만큼만 받는다 (quit-with-status-1 이 outb/inb 등을
 * 스텁하지 않고 부를 수 있게).
 */
export function restoreTextMode(host                          )       {
  host.int10(3);
}

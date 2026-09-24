// 원본 DZONE.EXE 의 그래픽 초기화·모드 전환 디스패처 재구현.
//
//   0x13A7F  graphicsInitOrMode      인자 두 개로 네 갈래 중 하나를 골라 BGI 를 부른다
//   0x13A5F  svga16DetectCallback   위가 installuserdriver 로 등록하는 감지 콜백. sbyte([0x4D79]) + 2 를 낸다
//
// 바이트 근거는 disasm/addr_0x13A7F.md 에 있다. 정답표는 goldens/graphics_init_vectors_v1
// 이고 port/test/graphics_init.test.ts 가 그것으로 판정한다.
//
// 이 함수는 shipped 설정에서 DGROUP 에 아무것도 안 쓰고 값도 안 돌려준다. 하는 일이
// 전부 BGI 진입점 호출(하드웨어·라이브러리)이다. 그래서 정답표는 "주어진 (arg, mode)
// 에서 어느 BGI 진입점이 어느 순서로 불렸나 + mode==1 갈래의 DGROUP 쓰기" 다. 원본을
// 그 네 입력으로 돌려 로그포인트로 받았다.
//
//   arg = [bp+6] 의 하위 바이트 (cmp byte [bp+6], 0)
//   mode = [0x4D79] 의 바이트   (cmp byte [0x4D79], 1) — 로더 0x13B00 이 dzone.key 바이트 59 로 넣는다
//
//   arg != 0, mode == 1 : [0x4DA2]=9 ; [0x4DA0]=2 ; initgraph(&0x4DA2, &0x4DA0, "EGAVGA")
//   arg != 0, mode != 1 : installuserdriver("svga16", 0x040B:0xF9AF) ; initgraph(&local, &local, "")
//   arg == 0, mode == 1 : near call 0x4229   (0x140B 를 못 벗어나므로 이미지 산술로 0x4229. anchor 미확인.)
//   arg == 0, mode != 1 : setgraphmode(sbyte(mode) + 2)
//
// shipped dzone.key 는 [0x4D79] = 2 라 mode != 1 갈래 둘만 실제로 돈다. mode == 1 갈래
// 둘은 anchor 가 4가지로 죽은 코드임을 실측했지만, [0x4D79] 를 1 로 주고 원본을 돌려
// 네 갈래를 다 받았다 — near call 0x4229 도 복귀했다.
//
// BGI 진입점 주소 (세그먼트 0x140B):
//   0x0BDE installuserdriver · 0x096A initgraph · 0x0D76 setgraphmode
// 근거는 anchor — 인자 모양(far 포인터 셋 / 이름+코드 포인터 / 정수 하나)과 DGROUP 의
// 문자열 상수("EGAVGA" @ 0x25C9, "svga16" @ 0x25D0, "" @ 0x25D7).
//
// @원본 0x13A7F 0x13A5F

const u16 = (v        )         => v & 0xffff;
const sbyte = (v        )         => (v << 24) >> 24;

/** 0x13A7F 이 내보내는 한 가지 동작. */
                       
                                                      
                                                                        
                                                  
                                                                               
                                                                                  
                                         

/**
 * 원본 0x13A7F 을 옮긴 것. (arg, mode) 로 네 갈래 중 하나를 골라 효과 목록을 낸다.
 *
 * 디스어셈블을 그대로 옮겼다.
 *
 * ```
 * 0x13A8A: cmp byte [bp+6], 0 ; je 0x13AE1          -- arg == 0 이면 모드 전환
 * arg != 0:
 *   0x13A90: cmp byte [0x4D79], 1 ; jne 0x13AB3
 *   mode == 1:
 *     0x13A97: mov word [0x4DA2], 9
 *     0x13A9D: mov word [0x4DA0], 2
 *     0x13AD7: lcall 0x140B:0x096A  initgraph(&0x4DA2, &0x4DA0, "EGAVGA")
 *   mode != 1:
 *     0x13AC0: lcall 0x140B:0x0BDE  installuserdriver("svga16", 0x040B:0xF9AF)
 *     0x13AD7: lcall 0x140B:0x096A  initgraph(&[bp-2], &[bp-4], "")
 * arg == 0:
 *   0x13AE1: cmp byte [0x4D79], 1 ; jne 0x13AEE
 *   mode == 1:
 *     0x13AE9: push cs ; call 0x14229   -- near, 세그먼트 랩. 이미지 0x40B0 + ((0x14229-0x40B0) & 0xFFFF) = 0x4229
 *   mode != 1:
 *     0x13AEE: al = [0x4D79] ; cwde(cbw) ; add ax, 2 ; push ax
 *     0x13AF6: lcall 0x140B:0x0D76  setgraphmode(ax)
 * ```
 *
 * @param arg  [bp+6]. 0 이 아니면 그래픽을 올리고, 0 이면 모드만 바꾼다. 하위 바이트만 본다.
 * @param mode [0x4D79] 의 바이트. 1 이면 EGAVGA 경로(죽은 코드), 아니면 svga16 경로.
 */
export function graphicsInitOrMode(arg        , mode        )              {
  const out              = [];
  const m = mode & 0xff;

  if ((arg & 0xff) !== 0) {
    if (m === 1) {
      out.push({ kind: "writeWord", addr: 0x4da2, value: 9 });
      out.push({ kind: "writeWord", addr: 0x4da0, value: 2 });
      out.push({ kind: "bgi", entry: "initgraph", seg: 0x140b, off: 0x096a, path: "EGAVGA" });
    } else {
      out.push({
        kind: "bgi", entry: "installuserdriver", seg: 0x140b, off: 0x0bde,
        name: "svga16", cbSeg: 0x040b, cbOff: 0xf9af,
      });
      out.push({ kind: "bgi", entry: "initgraph", seg: 0x140b, off: 0x096a, path: "" });
    }
  } else {
    if (m === 1) {
      out.push({ kind: "nearCall", target: 0x4229 });
    } else {
      out.push({
        kind: "bgi", entry: "setgraphmode", seg: 0x140b, off: 0x0d76,
        mode: u16(sbyte(m) + 2),
      });
    }
  }
  return out;
}

/**
 * svga16 그래픽 드라이버 감지 콜백 (0x13A5F). `0x13A7F` 이 `installuserdriver("svga16",
 * 0x040B:0xF9AF)` 로 BGI 에 등록하는 것이고, 어떤 분기로도 안 닿고 오직 far 함수 포인터로만
 * 불린다.
 *
 * ```
 * push ds ; ds = DGROUP (0x1AA6 재배치)   -- 남의 라이브러리 코드에서 불리므로 DS 를 직접 세운다
 * al = [0x4D79] ; cwde(cbw)               -- 비디오 모드 선택자 바이트를 부호 확장
 * ax += 2
 * pop ds ; retf                           -- ax 를 그대로 돌려준다
 * ```
 *
 * 돌려주는 값은 `sbyte([0x4D79]) + 2` 다. `graphicsInitOrMode` 의 모드 전환 갈래가 부르는
 * `setgraphmode(sbyte([0x4D79]) + 2)` 와 **같은 값** — anchor 가 "the same value the detect
 * callback returns" 라고 짚은 그것이다. 정답표로 확인: mode 0x80 → `sbyte` -128, +2 = -126,
 * 워드로 0xFF82.
 *
 * @param mode [0x4D79] 의 바이트.
 * @returns 16비트 값. BGI 는 이걸 모드 번호로 쓴다.
 */
export function svga16DetectCallback(mode        )         {
  return u16(sbyte(mode) + 2);
}

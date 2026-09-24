// 원본 DZONE.EXE 가 쓰는 조정된 바쁜 대기(calibrated busy-wait) 재구현.
//
//   0x136C6  calibratedBusyWait   인자 하나만큼 빈 반복을 돌고 0 을 돌려준다
//
// 바이트 근거는 disasm/addr_0x136C6.md 에 있다. 정답표는 goldens/wait_vectors_v1 이고
// port/test/wait.test.ts 가 그것으로 판정한다.
//
// 이 함수는 시간을 쓰는 것 말고는 아무 일도 안 한다. 포트 접근도, 인터럽트도, BIOS 틱
// 읽기도 없고 메모리에 한 바이트도 안 쓴다. 몸통에 나오는 메모리 피연산자는 조정 워드
// (DGROUP 오프셋 0x4D6F)를 읽는 것 하나뿐이다. 그래서 돌려주는 값(언제나 0)으로는
// 판정할 수 없고, **원본 CPU 가 실제로 실행한 명령 수**를 정답표로 삼는다. 이 재구현은
// 원본의 반복을 그대로 돌면서 원본이 밟는 명령을 하나씩 센다.
//
// 조정 워드는 부팅 때 속도 측정으로 정해지고, 게임 메인 루프가 라운드가 진행되는 동안
// 절반으로 줄였다가 되돌린다. 그래서 같은 인자로 불러도 라운드의 어느 시점이냐에 따라
// 걸리는 시간(=명령 수)이 달라진다. 정답표는 조정 워드도 입력으로 받아 그 폭을 덮는다.
//
// @원본 0x136C6

const i16 = (v        )         => (v << 16) >> 16;
const u16 = (v        )         => v & 0xffff;

/**
 * 원본 0x136C6 을 명령 수까지 맞춰 돌린다.
 *
 * 디스어셈블을 그대로 옮긴 것이다. 관용적으로 고치지 않았다 — 반복의 모양과 각 명령이
 * 세는 자리를 원본에 맞춰 두었다.
 *
 * ```
 * 136C6: push bp            ┐
 * 136C7: mov bp, sp         │ 앞머리 다섯 (마지막은 136E1 로 건너뛴다)
 * 136C9: push si            │
 * 136CA: xor cx, cx         │
 * 136CC: jmp 0x136E1        ┘
 * 136CE: xor si, si            ┐ 바깥 반복 몸통
 * 136D0: jmp 0x136D3           │
 * 136D2: inc si                │ 안쪽 반복이 jg 를 뛸 때마다
 * 136D3: mov ax, [0x4D6F]      │ ┐ 안쪽 검사 여섯 — 반복마다 조정 워드를 다시 읽고
 * 136D6: mov bx, 5             │ │ 다시 5 로 나눈다. 결과가 늘 같아도 비용은 매번 든다.
 * 136D9: cwd                   │ │ (opcode 0x99 는 16비트라 cwd 다. cdq 로 찍히기도 한다.)
 * 136DA: idiv bx              │ │ ax = int16(조정 워드) / 5, 0 으로 버림
 * 136DC: cmp ax, si            │ │
 * 136DE: jg 0x136D2           │ ┘ ax > si 면 다시 위로
 * 136E0: inc cx               ┘
 * 136E1: cmp cx, [bp + 6]     ┐ 바깥 검사 둘 — [bp+6] 은 인자다. jl 이라 부호 있게 본다.
 * 136E4: jl 0x136CE           ┘
 * 136E6: xor ax, ax           ┐
 * 136E8: jmp 0x136EA          │ 뒷머리 다섯 (jmp 는 바로 다음으로 뛰지만 명령은 명령이다)
 * 136EA: pop si               │
 * 136EB: pop bp               │
 * 136EC: retf                 ┘
 * ```
 *
 * @param arg    스택 top 의 인자([bp+6]). 바깥 반복 횟수. 부호 있는 16비트로 본다.
 * @param counter 조정 워드(0x4D6F)에 들어 있는 값. 부호 있는 16비트로 본다.
 * @returns returned 는 원본이 돌려주는 값(늘 0), instructions 는 원본이 실행한 명령 수.
 */
export function calibratedBusyWait(
  arg        ,
  counter        ,
)                                             {
  let ins = 0;

  // 136C6 push bp · 136C7 mov bp,sp · 136C9 push si · 136CA xor cx,cx · 136CC jmp 136E1
  ins += 5;

  let cx = 0;
  const bound = i16(arg); // [bp+6]

  for (;;) {
    // 136E1 cmp cx,[bp+6] · 136E4 jl 136CE
    ins += 2;
    if (!(i16(cx) < bound)) break; // jl 안 뛰면 바깥 반복 끝

    // ── 바깥 반복 몸통 ──
    // 136CE xor si,si · 136D0 jmp 136D3
    ins += 2;
    let si = 0;

    for (;;) {
      // 136D3 mov ax,[0x4D6F] · 136D6 mov bx,5 · 136D9 cwd · 136DA idiv bx
      //   · 136DC cmp ax,si · 136DE jg 136D2
      ins += 6;
      const ax = Math.trunc(i16(counter) / 5); // idiv: 0 으로 버리는 부호 있는 나눗셈
      if (!(ax > i16(si))) break; // jg 안 뛰면 안쪽 반복 끝
      // 136D2 inc si
      ins += 1;
      si = u16(si + 1);
    }

    // 136E0 inc cx
    ins += 1;
    cx = u16(cx + 1);
  }

  // 136E6 xor ax,ax · 136E8 jmp 136EA · 136EA pop si · 136EB pop bp · 136EC retf
  ins += 5;

  return { returned: 0, instructions: ins };
}

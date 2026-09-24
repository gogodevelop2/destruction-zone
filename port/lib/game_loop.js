// 원본 DZONE.EXE 의 게임 루프 0x0AC29 를 재구현한다.
//
// main 0x04DC7 이 라운드마다 부른다 (0x04E32·0x04E3D·0x04E48). 라운드 하나를 처음부터
// 끝까지 돌리고, 라운드가 끝나면 결과 화면 0x090E9 가 AL 에 남긴 값을 그대로 돌려준다
// (0x0ADDD 의 call 과 0x0AEB7 의 retf 사이에 AL 을 건드리는 명령이 없다).
//
// 앞머리 (반복 밖, 한 번)
//   0x13A7F(0) 그래픽 초기화 → 0x13C52 라운드 팔레트 → 0x07C95 라운드 설정.
//
// 반복 한 번 (최상단 0x0AC41, 되돌아가는 분기는 0x0AEB1 하나, 나가는 길은 0x0ADE0 하나)
//   1. DOS 입력 버퍼를 비운다: while (kbhit()) getch().
//   2. 0x0AEB8 키보드 포트를 읽어 스캔코드 고리에 넣는다.
//   3. 고리 쓰기 색인 0x4D90 이 0 이 아닐 때만 0x0AEE3 이 플레이어별 입력으로 바꾼다.
//   4. 0x0B33F 오토파일럿, 0x0E128(0) 탱크 이동, 0x0F3CA 물체 갱신, 0x12FD5 색 점멸과
//      부활, 팀 모드(0x4D65)면 0x1229C(0) 표식.
//   5. 속도 조절기. 기량 표 0x4CC0(보폭 0x15)의 머리 바이트가 0 인 슬롯, 즉 사람이 모는
//      슬롯마다 32비트 카운터를 0x4D6F*2 까지 센다. 타이머를 안 읽는 빈 루프라서 반복
//      하나의 길이가 CPU 속도로 정해진다 — 에뮬레이터에서는 conf 의 cycles 가 곧 시간이다.
//      포트는 셀 횟수만 계산해 host.spin 에 넘긴다. 얼마나 기다릴지는 host 가 정한다.
//   6. 0x4D8F 가 40 을 넘으면 0x4D8F % 탱크 수 + 1 로 줄이고 그 슬롯의 상태 칸 둘
//      (0x1261B 모드 2, 3)을 다시 그린다. 이어서 0x4D74 가 서 있고 0x4D8F 가 1 이고
//      0x4D6F 가 아직 재어 둔 값 0x4D6D 그대로이고 살아 있는 사람 탱크가 하나도 없으면
//      0x4D6F = 0x4D6F/2 + 8 로 속도 조절을 한 번 푼다.
//   7. 0x4D8F += 탱크 수.
//   8. 라운드 끝 바이트 0x4D66 이 0 이 아니면: 2 일 때 0x0DFEB(ESC 로 끝낸 상금), 이번
//      라운드에 입력이 없던(+0x80 == 0) 사람 슬롯의 기량을 0x4D77 로 덮고, 0x090E9 결과
//      화면을 부르고 나간다.
//   9. 앞의 세 슬롯까지(탱크 수를 넘지 않게), 사람 슬롯만 발사 걸쇠 +0x07 을 본다.
//      1 이면 0x1077D(i) 로 쏜다. 자동 연사(+0x3C 가 서 있고 +0x34 가 1)면 걸쇠를 하나씩
//      올리다가 0x4D63/10 을 넘으면 1 로 되돌린다. 아니면 걸쇠를 0 으로 지운다.
//
// 반복 한 번이 정확히 훅 자리 0x0AC41 두 히트 사이라는 것은 [0x4D8F] 가 두 히트 사이에
// [0x4D73] 만큼 느는 것으로 실측했다 (devlog 110).
//
// 정답표: goldens/game_loop_vectors_v1/  (다시 만들기: tools/capture_game_loop.py)
// @원본 0x0AC29
const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

const TANK = 0x43fc, STRIDE = 0x176;
const SKILL = 0x4cc0, SKILL_STRIDE = 0x15;   // 머리 바이트 0 = 사람, 1..5 = 로봇 기량

                               
                                               
                                               
                                               
                                                    
                                               
                                               
                                               
                                               
                                               
                                               
                                               
                                               
                                      
                            
                                                                       
                                               
                                                       
                                               
 

function idiv16(a        , b        )                           {
  const q = Math.trunc(i16(a) / i16(b));
  if (i16(b) === 0 || q !== i16(q)) throw new Error(`idiv16: ${i16(a)} / ${i16(b)} — 원본은 INT 0`);
  return { q, r: i16(a) % i16(b) };
}

/** 0x0AC29. dg 는 64KiB DGROUP. 라운드가 끝나면 결과 화면의 AL 을 돌려준다. */
export function runGameLoop(host              , dg            )         {
  const rd8 = (a        ) => dg[u16(a)];
  const rd16 = (a        ) => dg[u16(a)] | (dg[u16(a + 1)] << 8);
  const wr8 = (a        , v        ) => { dg[u16(a)] = v & 0xff; };
  const wr16 = (a        , v        ) => { wr8(a, v); wr8(a + 1, v >> 8); };
  const count = () => sbyte(rd8(0x4d73));
  const rec = (i        ) => u16(TANK + i16(i * STRIDE));
  const skill = (i        ) => u16(SKILL + i16(i * SKILL_STRIDE));

  host.graphicsInit(0);
  host.roundPalette();
  host.roundSetup();

  for (;;) {
    // 1~4 (0x0AC41..0x0AC89)
    while (host.kbhit() !== 0) host.getch();
    host.sampleKeyboard();
    if (rd8(0x4d90) !== 0) host.dispatchInput();
    host.autopilot();
    host.tankMove(0);
    host.updateObjects();
    host.respawn();
    if (rd8(0x4d65) !== 0) host.markers(0);

    // 5 (0x0AC8A..0x0ACD2). 한계는 16비트 shl 뒤 cwd 로 늘린 값이라 음수면 0번 돈다.
    for (let i = 0; count() > i; i++) {
      if (rd8(skill(i)) !== 0) continue;
      host.spin(Math.max(0, i16(rd16(0x4d6f) << 1)));
    }

    // 6 (0x0ACD4..0x0AD78). 비교는 부호 있는 바이트다.
    if (sbyte(rd8(0x4d8f)) > 0x28) {
      wr8(0x4d8f, idiv16(sbyte(rd8(0x4d8f)), count()).r + 1);
      host.statusPanel(2, (rd8(0x4d8f) - 1) & 0xff);
      host.statusPanel(3, (rd8(0x4d8f) - 1) & 0xff);
      if (rd8(0x4d74) !== 0 && rd8(0x4d8f) === 1 && rd16(0x4d6f) === rd16(0x4d6d)) {
        let i = 0;
        for (; count() > i; i++) {
          if (rd8(rec(i) + 0x00) === 0 && rd8(rec(i) + 0x02) === 0) break;  // 살아 있는 사람
        }
        if (count() === i) wr16(0x4d6f, idiv16(rd16(0x4d6f), 2).q + 8);
      }
    }

    // 7
    wr8(0x4d8f, rd8(0x4d8f) + rd8(0x4d73));

    // 8 (0x0AD82..0x0ADE0)
    if (rd8(0x4d66) !== 0) {
      if (rd8(0x4d66) === 2) host.escAward();
      for (let i = 0; count() > i; i++) {
        if (rd8(rec(i) + 0x80) === 0 && rd8(rec(i) + 0x00) === 0) wr8(skill(i), rd8(0x4d77));
      }
      return host.resultScreen() & 0xff;
    }

    // 9 (0x0ADE3..0x0AEAE). 탱크 수를 먼저 보고 그 다음 i < 3 을 본다.
    for (let i = 0; count() > i && i < 3; i++) {
      if (rd8(skill(i)) !== 0) continue;
      const b = rec(i);
      if (rd16(b + 0x07) === 0) continue;
      if (rd16(b + 0x07) === 1) host.fire(i & 0xff);
      if (rd8(b + 0x3c) !== 0 && rd8(b + 0x34) === 1) {
        wr16(b + 0x07, rd16(b + 0x07) + 1);
        if (i16(rd16(b + 0x07)) > idiv16(rd16(0x4d63), 10).q) wr16(b + 0x07, 1);
      } else {
        wr16(b + 0x07, 0);
      }
    }
  }
}

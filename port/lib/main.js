// 원본 DZONE.EXE 의 main 0x04DC7 을 재구현한다.
//
// Borland 시동 코드가 0x00155 의 far call 로 부른다. 그 앞에서 DGROUP 0x88/0x86/0x84 의
// 세 워드(argc/argv/envp)를 쌓으므로 C 의 main 이다. main 은 인자를 안 읽는다.
//
// 앞머리 (한 번)
//   1. 0x04C97 시작 씨앗과 속도 측정.
//   2. 플래그 0x1337 이 0 이면 0x13F00 셰어웨어 안내, 아니면 0x13A7F(1) 그래픽 초기화.
//   3. 0x040B4(3) 모드 X 진입.
//   4. 0x4D6A 가 0 이면 0x04BD9(0x21B8) 로 그림 파일을 둘째 페이지에 읽는다.
//
// 바깥 반복 (0x04DFF, 끝이 없다)
//   0x054AD 메뉴 → 0x079AE 대전 준비 → 0x4D67(남은 라운드) = 0x4D68. 0x1337 이 0 이면
//   0x4D67 = 0 이라 라운드를 안 돈다.
//   안쪽 반복 (0x4D67 != 0 인 동안): 0x05FB3 상점, 그 다음 게임 루프 0x0AC29 를 세 번.
//   · 상점이 0 이 아닌 AX 를 돌려주거나 게임 루프가 0 이 아닌 AL 을 돌려주면 바깥 반복의
//     처음(메뉴)으로 간다.
//   · 첫 번째 게임 루프만 0x4D67 != 0 일 때 부른다. 두 번째와 세 번째는 조건 없이 부른다.
//     0x4D67 은 라운드 설정 0x07C95 가 라운드마다 하나 줄이므로, 라운드 수가 3 의 배수가
//     아니면 0 을 지나 0xFF 로 감기고 안쪽 반복이 계속된다.
//
// 0x04E5A 의 pop bp; retf 로 가는 길이 없다 — main 은 돌아오지 않는다. 프로그램은 다른
// 함수(메뉴의 exit 따위)에서 끝난다. 포트도 돌아오지 않고, 끝내는 것은 host 가 던지는
// 예외다.
//
// 정답표: goldens/main_vectors_v1/  (다시 만들기: tools/capture_main.py)
// @원본 0x04DC7
                           
                                                
                                                
                                                
                                                
                                                                    
                                                
                                                
                                                        
                                                        
 

/** 0x04DC7. dg 는 64KiB DGROUP. 돌아오지 않는다. */
export function runMain(host          , dg            )        {
  host.startupCalibration();
  if (dg[0x1337] === 0) host.startupGreeting();
  else host.graphicsInit(1);
  host.modeXEnter(3);
  if (dg[0x4d6a] === 0) host.imageLoad(0x21b8);

  for (;;) {
    host.mainMenu();
    host.matchSetup();
    dg[0x4d67] = dg[0x4d68];
    if (dg[0x1337] === 0) dg[0x4d67] = 0;

    // 0x04E1C..0x04E56. 어느 한 곳이라도 0 이 아니면 바깥 반복으로 돌아간다.
    while (dg[0x4d67] !== 0) {
      if ((host.shop() & 0xffff) !== 0) break;
      if (dg[0x4d67] !== 0 && (host.gameLoop() & 0xff) !== 0) break;
      if ((host.gameLoop() & 0xff) !== 0) break;
      if ((host.gameLoop() & 0xff) !== 0) break;
    }
  }
}

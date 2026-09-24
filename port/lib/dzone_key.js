// 원본 DZONE.EXE 가 dzone.key 를 DGROUP 으로 읽어 들이는 함수 재구현.
//
//   0x13B00  loadDzoneKeySettings   dzone.key(64바이트, "rb")를 열어 DGROUP 에 푼다
//   0x13EDE  test4D78NoEffect       0x4D78(파일 36)을 시험하지만 아무 일도 안 한다. ax 엔 그 바이트가 남는다
//
// 바이트 근거는 disasm/addr_0x13B00.md 에 있다. 정답표는 goldens/dzone_key_vectors_v1 이고
// port/test/dzone_key.test.ts 가 그것으로 판정한다 (성공 경로만 — 아래).
//
// 이 함수는 값을 안 돌려주고, 하는 일이 전부 DGROUP 쓰기다. 그래서 정답표는 부르고 난
// 뒤의 DGROUP 바이트다. 설정 프로그램(SETUP.EXE)이 바꿀 수 있는 모든 것 — 조작키·비디오
// 모드·속도 — 이 여기로 들어온다.
//
//   fopen("dzone.key", "rb")        -- DS:0x25D8 = "dzone.key", DS:0x25E2 = "rb"
//   핸들 == 0:  printf("\n\nPlease run setup. \n") ; sound(1000);delay(50);nosound();delay(40) ; exit(1)
//   핸들 != 0:
//       fread(0x4D3E, 9, 4, 핸들)        -- 파일 0..35 (9바이트 x 4. 0x4D47/0x4D50/0x4D59 키 행 포함)
//       fgetc -> [0x4D78]               -- 파일 36
//       fgetc -> [0x4D74]               -- 파일 37
//       fread(local, 20, 1, 핸들)        -- 파일 38..57
//       i = 0..19:  x = (0xFA - local[i]) & 0xFF ;  if x == 0x5F: x = 0x20 ;  [0x4D7A+i] = x
//       fgetc -> [0x4D77]               -- 파일 58
//       fgetc -> [0x4D79]               -- 파일 59  (비디오 모드 선택자)
//       fgetc -> [0x4D6A]               -- 파일 60
//       fgetc -> [0x4D69]               -- 파일 61
//       fgetc -> [0x4D6C]               -- 파일 62  (0x4C97 의 속도 식에서 빼는 값)
//       fgetc -> [0x4D6B]               -- 파일 63  (0x4C97 의 속도 식에서 더하는 값)
//       [0x4D8E] = ([0x4D41] > 0xC7) ? 1 : 0     -- 0x4D41 = 0x4D3E 블록 넷째 바이트 = 파일[3]. jbe(부호 없음).
//       fclose
//
// 36 + 1 + 1 + 20 + 6 = 64 라 파일이 남김없이 소비된다.
//
// 이름 필드(파일 38..57)는 0xFA 의 보수로 저장돼 있다. 밑줄(0x5F)은 빈칸(0x20)으로 바뀐다
// — 설정 프로그램이 쓴 이름의 밑줄이 빈칸이 되도록.
//
// 열기 실패 경로는 정답표가 없다. exit(1)(lcall 0x113F)로 프로그램이 끝나 값을 안 내고,
// call_function 으로 부르면 에뮬레이터의 게임이 종료된다. dzone.key 도 늘 있으므로
// fopen 을 실패시키려면 rom/DZONE.KEY 를 치워야 하는데 rom/ 은 수정 금지다. 옮기되
// port/status.tsv 에 `일부옮김` 으로 적었다.
//
// @원본 0x13B00 0x13EDE

const KEY_LEN = 64;

const u16 = (v        )         => v & 0xffff;
const sbyte = (v        )         => (v << 24) >> 24;

/**
 * 0x4D78(dzone.key 파일 36)을 읽어 시험하지만 **양쪽 갈래가 한 자리로 합쳐져** 아무 일도
 * 안 한다 (0x13EDE). 15바이트, 호출하는 곳 셋(0x090D7, 0x090DC, 0x09EF9), 쓰기 없음.
 *
 * ```
 * al = [0x4D78] ; cwde(cbw) ; or ax, ax
 * jne 0x13EEB          ┐ 두 갈래의 목적지가 같다 (0x13EEB = 에필로그의 pop bp)
 * jmp 0x13EEB          ┘ 그래서 0x4D78 이 무엇이든 동작이 안 갈린다
 * pop bp ; retf
 * ```
 *
 * 소스에 조건이 있었는데 양쪽 몸통이 비었거나 지워졌고 시험만 남았다. 부수 효과가 하나
 * 있어서 옮긴다 — 로드(0x13EE1) 뒤로 ax 를 건드리는 것이 없으므로 `retf` 시점에 ax 는
 * 부호 확장된 0x4D78 을 담는다. C 규칙으로는 빈 `if` 함수가 쓰레기를 돌려주지만 이 컴파일
 * 결과는 그 바이트를 돌려준다. 세 호출처가 그 값을 쓰는지는 그 함수들을 옮길 때 정해진다.
 * 그때까지는 **부작용 없는 게터**로 둔다. 정답표로 확인: 0x80 → `sbyte` -128, 워드로 0xFF80.
 *
 * @param b4D78 [0x4D78] 의 바이트.
 * @returns 부호 확장된 값 (16비트). 원본이 ax 에 남기는 것.
 */
export function test4D78NoEffect(b4D78        )         {
  return u16(sbyte(b4D78));
}

/** dzone.key 를 읽은 결과. 성공이면 DGROUP 셀들, 실패면 부수효과 목록. */
                            
     
                      
                                                                               
                         
                                                                     
                         
                              
                              
                              
                                                                  
                              
                              
                              
                              
                                               
     
     
                     
                                                            
                        
      

/**
 * 원본 0x13B00 을 옮긴 것. 파일 바이트를 주면 성공 경로, null 이면 열기 실패 경로.
 *
 * 디스어셈블을 그대로 옮겼다. fread/fgetc 의 순서·크기가 곧 파일의 배치다.
 *
 * @param file dzone.key 의 전체 64바이트, 또는 열기 실패면 null.
 */
export function loadDzoneKeySettings(file                   )                 {
  if (file === null) {
    // 0x13B1B 에서 떨어지는 갈래. disasm 직역.
    return {
      openFail: true,
      effects: [
        'printf("\\n\\nPlease run setup. \\n")', // 0x13B21
        "sound(1000)",                            // 0x13B2B
        "delay(50)",                              // 0x13B35
        "nosound()",                              // 0x13B3B
        "delay(40)",                              // 0x13B44
        "exit(1)",                                // 0x13B4E — 복귀하지 않는다
      ],
    };
  }

  if (file.length !== KEY_LEN) {
    throw new RangeError(`dzone.key 는 ${KEY_LEN}바이트여야 한다 (받은 것 ${file.length})`);
  }

  const r_4D7A = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    let x = (0xfa - file[38 + i]) & 0xff;
    if (x === 0x5f) x = 0x20;
    r_4D7A[i] = x;
  }

  return {
    openFail: false,
    r_4D3E: file.slice(0, 36),
    r_4D7A,
    b_4D78: file[36],
    b_4D74: file[37],
    b_4D77: file[58],
    b_4D79: file[59],
    b_4D6A: file[60],
    b_4D69: file[61],
    b_4D6C: file[62],
    b_4D6B: file[63],
    b_4D8E: file[3] > 0xc7 ? 1 : 0,
  };
}

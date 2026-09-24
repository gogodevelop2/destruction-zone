// 원본 DZONE.EXE 가 dzone.cnf 를 DGROUP 으로 읽어 들이는 함수 재구현.
//
//   0x05BA0  readDzoneCnf   dzone.cnf(2373바이트, "rb")를 열어 DGROUP 에 푼다
//
// 바이트 근거는 disasm/addr_0x05BA0.md 에 있다. 정답표는 goldens/cnf_read_vectors_v1 이고
// port/test/cnf_read.test.ts 가 그것으로 판정한다 (성공 경로만 — 아래).
//
// 이 함수는 값을 안 돌려주고(ax 정리 없음), 하는 일이 전부 DGROUP 쓰기다. 그래서 정답표는
// 부르고 난 뒤의 DGROUP 바이트다.
//
//   fopen("dzone.cnf", "rb")           -- DS:0x222F = "dzone.cnf", DS:0x2239 = "rb"
//   핸들 == 0 (열기 실패):
//       [0x4D73] = 6 ; [0x4D68] = 6 ; [0x4D65] = 0
//       di = 0..5: strcpy(0x4CC1 + di*0x15, "unknown")   -- DS:0x223C = "unknown"
//       (fclose 를 안 부르고 곧장 나간다)
//   핸들 != 0:
//       fread(0x4CC0, 126,  1, 핸들)    -- 파일 바이트 0..125
//       fread(0x43FC, 2244, 1, 핸들)    -- 파일 바이트 126..2369
//       fgetc -> [0x4D73]               -- 파일 바이트 2370
//       fgetc -> [0x4D68]               -- 파일 바이트 2371
//       fgetc -> [0x4D65]               -- 파일 바이트 2372
//       fclose
//
// 126 + 2244 + 3 = 2373 이라 파일이 남김없이 소비된다.
//
// 열기 실패 경로는 정답표가 없다. 값이 전부 즉치(6/6/0)와 리터럴 strcpy("unknown")이라
// 원본을 돌려야만 알 수 있는 것이 없고, fopen("dzone.cnf")를 실패시키려면 rom/DZONE.CNF
// 를 치워야 하는데 rom/ 은 수정 금지다. 그래서 옮기되 port/status.tsv 에 `일부옮김` 으로
// 적었다. strcpy 는 "unknown\0" 8바이트만 쓰고 레코드의 나머지(8..0x14)는 안 건드린다.
//
// @원본 0x05BA0

/** dzone.cnf 를 읽은 결과. 성공이면 세 영역과 세 바이트, 실패면 기본값. */
                         
                                                 
                      
                                                    
                      
                                                                      
                                   
                               
                                
                 
                 
                 
  

const CNF_LEN = 2373;
const HEAD = 126;   // fread #1 → 0x4CC0
const BODY = 2244;  // fread #2 → 0x43FC

/**
 * 원본 0x05BA0 을 옮긴 것. 파일 바이트를 주면 성공 경로, null 이면 열기 실패 경로.
 *
 * 디스어셈블을 그대로 옮겼다. fread 두 번과 fgetc 세 번의 순서·크기가 곧 파일의 배치다.
 *
 * @param file dzone.cnf 의 전체 바이트, 또는 열기 실패면 null.
 */
export function readDzoneCnf(file                   )            {
  if (file === null) {
    // 0x05BB8 에서 떨어지는 갈래. disasm 직역 (원본을 돌려 확인한 값이 아니다).
    const unknown = new Uint8Array([0x75, 0x6e, 0x6b, 0x6e, 0x6f, 0x77, 0x6e, 0x00]); // "unknown\0"
    return {
      openFailRecordWrite: unknown,
      openFailRecordCount: 6,
      openFailRecordStride: 0x15,
      b_4D73: 6,
      b_4D68: 6,
      b_4D65: 0,
    };
  }

  if (file.length !== CNF_LEN) {
    // 원본은 크기를 안 본다 — fread/fgetc 가 파일 끝을 넘으면 그만큼 안 채운다. 여기서는
    // 배치가 어긋난 파일을 조용히 넘기지 않으려고 막는다.
    throw new RangeError(`dzone.cnf 는 ${CNF_LEN}바이트여야 한다 (받은 것 ${file.length})`);
  }

  return {
    r_4CC0: file.slice(0, HEAD),
    r_43FC: file.slice(HEAD, HEAD + BODY),
    b_4D73: file[HEAD + BODY],
    b_4D68: file[HEAD + BODY + 1],
    b_4D65: file[HEAD + BODY + 2],
  };
}

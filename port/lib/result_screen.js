// 원본 DZONE.EXE 의 라운드 결과 화면 도우미 재구현.
//
//   0x08FF0  resultScreenTextCell   결과 칸 하나에 라벨과 숫자를 그림자 글자로 그린다
//
// 바이트 근거는 disasm/addr_0x08FF0.md 에 있다. 정체는 analysis/result_screen.md 가
// "무엇을 그리는지 안 읽었다" 고 남겨 둔 것을 이번에 읽어 채웠다. 정답표는
// goldens/result_screen_vectors_v1 이고 port/test/result_screen.test.ts 가 판정한다.
//
// 이 함수는 라운드 결과 화면 0x090E9 전용이고 여덟 곳에서 서로 다른 인자로 불린다.
// 값을 안 돌려주고(언제나 0), DGROUP 에 아무것도 안 쓰며, 화면 그리기는 BGI 드라이버를
// 거친다. 그래서 값·명령 수·화면 메모리로는 판정할 수 없다. 대신 이 함수가 바깥에
// 내보내는 것 — drawString(0x136ED)을 어떤 인자로 부르는지, test-4d78(0x13EDE)를 몇 번
// 부르는지 — 을 효과 목록으로 담아 돌려준다.
//
//   ltoa(값, 지역버퍼, 10)                                       -- 0x031E5, 부호 있는 십진
//   drawString(x = geom - 55, y = yBase + 0x49, "mission   completed"@0x234C, colour 7)
//   drawString(x = geom - 53, y = yBase + 0x4B, "mission   completed"@0x2360, colour 슬롯색)
//   drawString(x = geom - 7,  y = yBase + 0x49, 숫자,                          colour 7)
//   drawString(x = geom - 5,  y = yBase + 0x4B, 숫자,                          colour 슬롯색)
//   0x13EDE() ; 0x13EDE()                                        -- 값은 버려진다 (곧 xor ax,ax)
//   return 0
//
//   geom  = (geomTable[[0x4D79]*4] - 39) / 2      -- 하드웨어 idiv, 0 쪽으로 자름.
//                                                   geomTable = DGROUP 0x1241, 4바이트 간격,
//                                                   워드0 = 그 모드의 최대 x
//   슬롯색 = colourSlots[slotIndex]               -- DGROUP 0x126F: 11,1,10,12,14,2,5,...
//
// 라벨 자리 두 곳(0x234C, 0x2360)의 문자열은 같은 "mission   completed" 인데 포인터가
// 다르다. 흰색(7) 한 벌과 슬롯색 한 벌을 (+2, +2) 어긋나게 그려 그림자 효과를 낸다.
// 숫자도 같은 방식이다. drawString 은 색을 하위 바이트만 읽는다.
//
// ===========================================================================
//   0x090E9  runResultScreen   라운드 사이 점수판 + 세부 통계 화면
// ===========================================================================
// 바이트 근거는 disasm/addr_0x090E9.md (2,980명령). 부르는 곳은 게임 루프 0x0AC29
// 한 곳(0x0ADDD)이고, 게임 루프는 이 함수가 AL 에 남긴 값을 그대로 돌려준다. main
// (0x04DC7)은 그 값이 0 이 아니면 라운드 루프를 벗어난다. 즉 이 함수는 화면을 그리고
// "대전을 계속할지"도 정한다.
//
// -- 함수의 모양 (2단계 옮길 때 이 순서로 낸다) -----------------------------------
// 큰 흐름은 화면 두 장을 거의 같은 절차로 그린다. 한 장을 그리는 절차는
// [버퍼 계산] -> [BGI 로 틀] -> [drawString 으로 제목과 줄] -> [키 기다리기] 이다.
//
//  1. 0x090E9..0x09137  점수 모으기. di 로 탱크를 돌며 탱크레코드 +0x4424 의 32비트
//     점수를 stride 4 배열 arr5c[di] 로 복사한다. 슬롯 +0x00(0x4CC0 보폭 0x15)이
//     0 이 아닌 참가자 수를 [bp-0x17] 에 센다 (로봇 수).
//  2. 0x0913C..0x09283  고르기 정렬. arr5c 에서 제일 큰 것을 골라 arr44[순위]=탱크색인
//     으로 적고 그 자리를 0xFFFF 로 지운다(다음 순위가 건너뛰게). 순위마다 ltoa 로
//     점수(0x11D6 거쳐 0x31E5), 점수차(0x442A:0x4428 뺀 값), 셋째 값(0x442E:0x442C,
//     0x3227)을 stride 6 버퍼 buf80/bufC8/buf110 에 넣는다.
//  3. 0x09284..0x09393  팀 합계. [0x4D65]!=0 일 때만. 팀 점수 두 개를 [0x3436:0x3434]
//     대 [0x3416:0x3414] 로 견주어 [bp-0x13] 에 1 또는 2 를 넣고, 팀별 총점(0x33F4~)을
//     ltoa 하고, 각 팀의 첫 탱크(순위 순)를 teamRep[1..2] 에 적는다.
//  4. 0x09394..0x0946B  배치와 팔레트. [0x4D65] 로 [bp-0xe] 를 정하고(자유전은
//     탱크수*0x50+0x6e, 팀전은 0x10e), [0x4D79] 모드로 geomTable(0x1241)에서 x,y
//     기준([bp-0xa],[bp-0xc])을 잰다 -- resultScreenTextCell 의 geom 과 같은 계산.
//     그 뒤 탱크마다 int 0x10 AX=0x1010 으로 VGA DAC 한 칸씩 쓴다(색표 0x126F,
//     팔레트값 0x33AC 보폭 3). ★ 직접 BIOS 호출이다.
//  5. 0x0946D..0x09A48  점수판 그리기. 0x140B 세그먼트의 BGI 껍데기로 틀을 그리고
//     (setfillstyle 0x152E0, bar 0x15D14, setcolor 0x15E3E, rectangle 0x1526D,
//     line 0x15CB1), drawString(0x136ED)으로 제목과 탱크별 줄을 그린다. 팀전이면
//     0x098C0 의 다른 제목 블록으로 간다(0x1191 로 0xF 바이트 복사 뒤 4줄). 둘 다
//     0x09A4B 에서 합류한다.
//  6. 0x09A4B  남은 라운드 갈림. [0x4D67]==0 이면 0x09A55(대전 끝), 아니면
//     0x09E03(라운드 남음). 두 갈래는 0x09EF0 에서 다시 합류한다 -- 이것은 구간
//     경계가 아니라 첫 화면의 글만 고른다.
//       6a. 0x09A55..0x09E00  슬롯 종류 히스토그램([bp-0x1a/1c/1e/20/22/24/26])을
//           만들고, AND 로 엮은 조건 8개를 차례로 본다. 하나가 맞으면 그 조건에 맞는
//           축하 줄을 resultScreenTextCell(0x08FF0)로 그리고 0x09E00 으로 나간다.
//           아무것도 안 맞으면 0x09D9E 의 기본 "mission completed" 두 줄.
//       6b. 0x09E03..0x09EED  "라운드 N / M" 진행 글을 0x136ED + 0x31E5 로 그린다.
//  7. 0x09EF0..0x09FF7  첫 키 기다리기. [0x4D67]==0 이면 먼저 test4d78(0x13EDE),
//     그다음 delay(300)(0x1FDA), 그다음 대기 루프: si=2500 에서 시작해 되풀이마다
//     rand()(0x149D) 하나를 쓰고, rand()*[0x4D63]/0x8000==0 일 때만 si 를 줄인다.
//     포트 0x60 을 직접 읽어 ESC(1)/S(0x1F)/SPACE(0x39) 면 즉시 나간다. 나가는 조건은
//     `si==0 && [bp-0x17]==[0x4D73]`. 그 뒤 [0x4D8E] 문(0 이 아니면 건너뜀), 그리고
//     ★ 죽은 exit(1) 블록(0x09FAC..0x09FCD, 아래 판단 참고), 그리고 'S' 키면 세부
//     화면으로, 아니면 (라운드 진행수 mod 0xF != 0) 일 때 0xAC11 로 바로 뛰어
//     세부 화면을 건너뛴다.
//  8. 0x09FFD..0x0A44C  탱크별 세부 버퍼 계산. 탱크마다 킬/데스(0x456E,0x4570),
//     다른 탱크 대상 합, 카탈로그 문자열 strcpy(0x3972), 최대/최소 상대(천적/봉),
//     무기 이름과 수치를 stringAppend(0x3A15) + ltoa 로 buf164/260/2b4/1e2/20c/1b8 에
//     쌓는다.
//  9. 0x0A458..0x0A7F5  세부 화면 그리기. geom 다시 재고([bp-0xc] -= 0x4B), BGI 틀,
//     제목 ~18개(0x136ED), 그다음 탱크별 세부 줄(loop, 0x136ED).
// 10. 0x0A7FD..0x0AC28  둘째 키 기다리기. delay(300), 대기 루프 si=7500(0x1D4C),
//     같은 모양(rand churn + 포트 0x60 직접 읽기, ESC/SPACE 만). 마지막에 다시
//     `in al,0x60` 하고 스캔코드가 1(ESC)이면 AL=1, 아니면 AL=0. 그것이 반환값이다.
//     0x0AC1D 의 `jmp 0xac23` 는 아무도 안 뛰는 죽은 1명령이다.
//
// -- 판정 경계 (1단계) ---------------------------------------------------------
// resultScreenTextCell 과 같은 부류다. data_writes 가 비어 있고(절대 DGROUP 에 안
// 쓴다), 그리기는 BGI 와 int 0x10 을 거치며, 반환값은 AL 하나다. 그래서 포트가
// 내보내는 것은:
//   (1) 밖으로 부른 것의 순서와 인자 -- drawString(x,y,strPtr,colour) ~54회,
//       resultScreenTextCell(a,b,c) 최대 8회, BGI 껍데기(setfillstyle/bar/setcolor/
//       rectangle/line) ~30회, int 0x10 팔레트 쓰기(index,r,g,b) 탱크수만큼,
//       delay(ms), test4d78 횟수, 문자열 포맷(0x31E5/0x3227/0x3972/0x3A15)의 입력과
//       결과 버퍼.
//   (2) 반환값 AL (0 또는 1).
//   (3) rand 소비 개수. 대기 루프 둘이 키가 안 들어오면 2500*94, 7500*94 규모로
//       난수를 태운다(analysis/result_screen.md). 원본 자체가 이 자리에서 완전한
//       결정론이 아니다 -- 키가 들어오는 정확한 명령이 소비 개수를 정한다. 그래서
//       골든은 씨앗-전, 씨앗-후, 소비 개수, 그리고 주입한 스캔코드 일정을 함께
//       담고, 포트는 대기 루프의 "되풀이마다 1 뽑기, rand%…==0 일 때만 카운트다운"
//       을 그대로 흉내 낸다.
// 픽셀은 안 담는다. BGI 드라이버(.GDA)는 2단계에서 다시 판단한다.
//
// -- 골든에 담을 값 ----------------------------------------------------------
// goldens/result_round_screen_vectors_v1/ (0x08FF0 의 result_screen_vectors_v1 과
// 다른 폴더). 경우마다: 씨앗-전/후, calls[] (위 (1)의 순서 목록), ret (AL),
// drawsConsumed, scancodesIn (주입 일정), 그리고 통제값으로 덮은 DGROUP 칸
// ([0x4D65]/[0x4D67]/[0x4D68]/[0x4D73]/[0x4D79]/[0x4D63]/[0x4D8E]/슬롯배열 0x4CC0/
// 탱크레코드). 라이브 DGROUP 으로 가고 통제값만 덮는다(작업 30 방식) -- 작업 29·31
// 의 정적 이미지 심기는 여기서 못 쓴다(devlog 102).
//
// @원본 0x08FF0 0x090E9

import { readFileSync } from "../../web/shim.js";
import { fileURLToPath } from "../../web/shim.js";
import { sdiv, smod, lmul, u32, i32 } from "./borland_long.js";
import { stringAppend } from "./text.js";
import { randStep } from "./rand.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

/** 0x08FF0 이 내보내는 한 가지 동작. */
                        
                                                                              
                         

// DGROUP 이미지 전체를 그대로 읽는다 (port/data/DGROUP.BIN = 실행 파일의 DGROUP 이미지 0x1AA60 부터, extract.ts). 원본은 `[bx+0x1241]`·`[di+0x126F]` 를 경계 검사 없이
// 읽으므로 (bx = sbyte(mode)*4 는 음수도 되고, di = slotIndex 는 워드 전체다), 포트도
// 4엔트리·16바이트 표가 아니라 DGROUP 을 통째로 두고 16비트로 접힌 주소로 색인해야
// 원본과 같아진다.
const DGROUP             = (() => {
  const dgroup = readFileSync(fileURLToPath(new URL("../data/DGROUP.BIN", import.meta.url)));
  return new Uint8Array(dgroup);
})();

function dgroupStr(offset        )         {
  const end = DGROUP.indexOf(0, offset);
  return new TextDecoder().decode(DGROUP.subarray(offset, end));
}
// ⚠ 여기 DGROUP 은 **파일에 들어 있는 값**, 즉 프로그램이 막 올라왔을 때의 값이다.
// 게임이 실행 중에 고치는 칸을 읽으면 원본과 달라진다. 실제로 걸린 자리가 하나 있다 —
// slotIndex 200 은 0x126F+200 = 0x1337 을 읽는데, 그 칸은 시작 함수 0x04C97 이 안내문
// 함수의 반환 바이트(늘 1)를 넣는 자리다. 파일에는 0 이 들어 있어서 포트는 0 을 내고
// 원본은 1 을 낸다. 색 슬롯은 원래 한 자릿수라 게임이 그런 값을 넘기지 않지만,
// **이 포트가 상수만 읽는다는 것을 잊으면 안 된다.** 그래서 그 경우는 정답표에 안 넣었다.
// 넣으면 실행 시점에 매인 값이 함수 정답표에 섞인다.
//
// 실행 파일에 들어 있는 DGROUP 은 13,228바이트(0x0000..0x33AB)뿐이다. 그 위는 게임이
// 실행 중에 쓰는 자리라 파일에 값이 없다. 이 함수가 닿는 범위는 그보다 아래다 —
// bx = sbyte(mode)*4 가 -512..508 이므로 0x1041..0x143D, di = slotIndex 가 바이트이므로
// 0x126F..0x136F. 그래서 아래의 0 은 실제로 쓰이지 않는다. 만약 쓰인다면 그것은 이 함수가
// 파일에 없는 자리를 읽었다는 뜻이고, 0 은 그 자리의 실행 중 값이 아니다.
function dgroupByte(off        )         {
  return DGROUP[u16(off)] ?? 0;
}
function dgroupWord(off        )         {
  return dgroupByte(off) | (dgroupByte(off + 1) << 8);
}

/** 두 라벨 자리의 문자열. 실측으로 둘 다 "mission   completed" 다. */
export const LABEL_1         = dgroupStr(0x234c);
export const LABEL_2         = dgroupStr(0x2360);

/**
 * 0x0901E..0x09035 의 x 기준값. `al=[0x4D79]; cwde(cbw); shl ax,1; shl ax,1` 로
 * `sbyte(mode)*4` 를 만들어(16비트, 음수면 위로 접힌다) DGROUP 의 `[bx+0x1241]` 워드를
 * 읽고, `-39` 한 뒤 부호 있는 `idiv 2` 로 나눈다.
 *
 * 표는 모드 0..3 만 담지만 원본은 경계를 안 본다 — mode 4 는 0x1251, mode 0x80 은
 * 0x1041, mode 0xFF 는 0x123D 의 DGROUP 워드를 읽는다. 정답표로 확인했다.
 */
function geomBase(mode        )         {
  const bx = u16(sbyte(mode) << 2);                 // sbyte(mode) * 4, 16비트
  const maxX = dgroupWord(0x1241 + bx);             // [bx + 0x1241]
  const n = i16(u16(maxX + 0xffd9));                // maxX - 39 (16비트, 부호 있게)
  return (n / 2) | 0;                               // idiv 2, 0 쪽으로 자름
}

/** 0x031E5(값, 버퍼, 10) — 부호 확장한 16비트 값의 십진 문자열. */
export function ltoaRadix10(value        )         {
  return String(i16(value));
}

/**
 * 원본 0x08FF0 을 옮긴 것. (value, yBase, slotIndex, mode) 로 효과 목록을 낸다.
 *
 * @param value     [bp+6]. 칸에 찍을 숫자 (부호 있는 16비트).
 * @param yBase     [bp+8]. 세로 기준. 라벨은 +0x49, 그림자는 +0x4B.
 * @param slotIndex [bp+0xa]. DGROUP 0x126F 색 슬롯 표의 색인 (바이트).
 * @param mode      [0x4D79]. 화면 모드 선택자. geometry 표를 색인한다.
 */
export function resultScreenTextCell(
  value        ,
  yBase        ,
  slotIndex        ,
  mode        ,
)                                            {
  const geom = geomBase(mode);
  // [di + 0x126F], di = [bp+0xa] 워드 전체. 경계 없음 — slot 20 은 0x1283 을 읽는다.
  const slotColour = dgroupByte(u16(slotIndex) + 0x126f);
  const num = ltoaRadix10(value);

  const effects               = [
    { kind: "drawString", x: u16(geom + 0xffc9), y: u16(yBase + 0x49), text: LABEL_1, colour: 7 },
    { kind: "drawString", x: u16(geom + 0xffcb), y: u16(yBase + 0x4b), text: LABEL_2, colour: slotColour },
    { kind: "drawString", x: u16(geom + 0xfff9), y: u16(yBase + 0x49), text: num, colour: 7 },
    { kind: "drawString", x: u16(geom + 0xfffb), y: u16(yBase + 0x4b), text: num, colour: slotColour },
    { kind: "test4D78" },
    { kind: "test4D78" },
  ];
  return { result: 0, effects };
}

// ═══════════════════════════════════════════════════════════════════════════
// 원본 0x090E9 (round-result-screen, 2980명령) 재구현.  runResultScreen.
// 함수의 모양·판정 경계·골든 설계는 이 파일 머리 주석의 0x090E9 절에 있다.
// ═══════════════════════════════════════════════════════════════════════════

const FRAME = 0x2b4;                 // sub sp, 0x2b4
const CAT_STRIDE = 0x3d;             // 카탈로그 레코드 보폭
const SLOT_STRIDE = 0x15;            // 슬롯 배열 0x4CC0 보폭
const TANK_STRIDE = 0x176;           // 탱크 레코드 보폭

/** runResultScreen 이 순서대로 쌓는 "밖으로 부른 것" 하나. */
                   
                                                                        
                                                                                   
                                                                        
                                                                                   
                                                                                   
                                                                                      
                                                                        
                                                                                              
                                                                        
                                                              // 0x13EDE

                               
                                                              
                                                             
                                                 
                                  
                                                        
                                                                    
                                                                    
                                                                       
                                                                     
                          
                                                         
                            
 

                            
                 
                                          
                                                          
                                   
 

/** 0x03227 plain ltoa(value_long, buf, radix). 부호 있는 32비트 십진 문자열. */
function ltoaLong(value        )         {
  return String(i32(value));
}
/** 0x031E5 ltoa-radix — 여기 호출은 전부 16비트 워드 하나에 radix 10. */
function ltoaWord(value        )         {
  return String(i16(value));
}
/** 0x11D6 계열. 스택에 나중 밀린 long 을 먼저 밀린 long 으로 부호 있게 나눈 몫. */
function bldiv(dividend        , divisor        )         {
  return sdiv(u32(dividend), u32(divisor));
}

/**
 * 원본 0x090E9 를 옮긴 것. 함수의 모양·판정 경계·골든 설계는 이 파일 머리 주석의
 * 0x090E9 절에 있다.
 *
 * @param dg     DGROUP 0x10000 바이트. 통제값(0x4D65/67/68/73/79/63/8E, 슬롯 0x4CC0,
 *               탱크 레코드 0x4424~)이 라이브 상태에 덮여 있어야 한다.
 * @param script 씨앗, 대기 루프 스캔코드 일정, 프레임 시작(bufBase).
 * @returns      calls(밖으로 부른 것 순서), endSeed(씨앗-후), ret(AL, 0 또는 1).
 */
export function runResultScreen(dg            , script              )            {
  const FB = (script.bufBase ?? 0xf94c) & 0xffff;   // 실제 값은 골든에서 온다
  const calls          = [];
  const out = (c       )       => { calls.push(c); script.emit?.(c); };
  const port = script.readPort;

  // ── 씨앗 실 ────────────────────────────────────────────────────────────
  let seed = u32(script.seed);
  let draws = 0;
  const draw = ()         => { const r = randStep(seed); seed = r.next; draws++; return r.result; };

  // ── 프레임을 dg 안 바이트로 본다 (지역이 겹친다: [bp+di-0x16] 등) ────────
  //   [bp-off]  →  dg[u16(FB + FRAME - off)]
  const fa = (off        )         => u16(FB + FRAME - off);
  const g8 = (off        )         => dg[fa(off)];
  const s8 = (off        , v        )       => { dg[fa(off)] = v & 0xff; };
  const g16 = (off        )         => dg[fa(off)] | (dg[u16(fa(off) + 1)] << 8);
  const gi16 = (off        )         => i16(g16(off));
  const s16 = (off        , v        )       => {
    dg[fa(off)] = v & 0xff; dg[u16(fa(off) + 1)] = (v >> 8) & 0xff;
  };
  // [bp+idx-baseOff] — 프레임 안 바이트 배열 원소.
  const fbi = (baseOff        , idx        )         => u16(FB + FRAME - baseOff + idx);
  // 프레임 안 버퍼 원소 주소 (baseOff 에서 시작, stride 간격, idx 번째).
  const buf = (baseOff        , idx        , stride        )         =>
    u16(FB + FRAME - baseOff + idx * stride);

  // ── 절대 DGROUP 접근 (16비트로 접힌 오프셋, 표를 자르지 않는다) ──────────
  const A8 = (at        )         => dg[u16(at)];
  const A16 = (at        )         => dg[u16(at)] | (dg[u16(at + 1)] << 8);
  const wA16 = (at        , v        )       => {
    dg[u16(at)] = v & 0xff; dg[u16(at + 1)] = (v >> 8) & 0xff;
  };
  const A32 = (at        )         => u32(A16(at) | (A16(u16(at + 2)) << 16));

  // ── C 문자열 읽기/쓰기 (프레임 버퍼도 dg 안이라 한 함수로 된다) ─────────
  const readCStr = (at        )         => {
    let p = u16(at); const out           = [];
    while (dg[p] !== 0) { out.push(dg[p]); p = u16(p + 1); }
    return String.fromCharCode(...out);                      // latin1: 바이트 하나가 글자 하나 (브라우저에는 Buffer 가 없다)
  };
  const writeCStr = (at        , s        )       => {
    let p = u16(at);
    for (let i = 0; i < s.length; i++) { dg[p] = s.charCodeAt(i) & 0xff; p = u16(p + 1); }
    dg[p] = 0;
  };

  const tankRec = (i        )         => u16(i16(i) * TANK_STRIDE);
  const slotRec = (i        )         => u16(i16(i) * SLOT_STRIDE);
  const tankCount = i16(sbyte(dg[0x4d73]));       // al=[0x4d73]; cwde 가 도처에 있다
  const teamMode = sbyte(dg[0x4d65]) !== 0;

  // arr5c: [bp-0x5c] stride 4 (lo=+0, hi=+2), 탱크수만큼. arr44: [bp-0x44] stride 2.
  const a5cLo = (j        )         => u16(FB + FRAME - 0x5c + j * 4);
  const a5cHi = (j        )         => u16(FB + FRAME - 0x5c + j * 4 + 2);
  const a44 = (r        )         => u16(FB + FRAME - 0x44 + r * 2);

  s8(0x17, 0);   // 0x090F2 [bp-0x17] = 0  (로봇 수 = 슬롯 +0x00 이 0 이 아닌 참가자)

  // ── 1구간 0x090FA..0x09137  점수 모으기 ───────────────────────────────
  for (let di = 0; di < tankCount; di++) {
    if (dg[u16(slotRec(di) + 0x4cc0)] !== 0) s8(0x17, g8(0x17) + 1);   // 0x09103
    const tr = tankRec(di);
    wA16(a5cHi(di), A16(u16(tr + 0x4426)));                             // 0x09121 arr5c[di].hi
    wA16(a5cLo(di), A16(u16(tr + 0x4424)));                             // 0x0912C arr5c[di].lo
  }

  // ── 2구간 0x0913C..0x09283  고르기 정렬 + 숫자 포맷 ───────────────────
  // 순위마다 남은 것 중 제일 큰 점수를 골라 arr44[순위]=탱크색인 으로 적고 지운다.
  for (let rank = 0; rank < tankCount; rank++) {
    let maxHi = 0xffff, maxLo = 0xffff, argmax = 0;   // [bp-6],[bp-8],[bp-4]
    for (let j = 0; j < tankCount; j++) {             // [bp-2]
      const jh = A16(a5cHi(j)), jl = A16(a5cLo(j));
      if (i16(jh) < i16(maxHi)) continue;             // 0x0915E cmp;jl → 건너뜀
      if (jh === maxHi && jl < maxLo) continue;       // 0x09163 jne 아님 + 0x09168 jb → 건너뜀
      maxHi = jh; maxLo = jl; argmax = j;             // 0x0916A 갱신
    }
    wA16(a44(rank), argmax);                          // 0x09193 arr44[rank] = argmax
    wA16(a5cLo(argmax), 0xffff);                      // 0x091A1 소비 표시
    wA16(a5cHi(argmax), 0xffff);

    const tr = tankRec(argmax);
    const scoreA = A32(u16(tr + 0x4424));
    const scoreB = A32(u16(tr + 0x4428));
    const scoreC = A32(u16(tr + 0x442c));
    const qa = bldiv(scoreA, 10) & 0xffff;            // 0x091E1 scoreA/10, 하위 워드만 씀
    const qb = bldiv(scoreB, 10) & 0xffff;            // 0x0921B scoreB/10
    writeCStr(buf(0x80, argmax, 6), ltoaWord(qa));                    // 0x091E7 buf80
    writeCStr(buf(0xc8, argmax, 6), ltoaWord(u16(qa - qb)));         // 0x09243 bufC8 (점수차)
    writeCStr(buf(0x110, argmax, 6), ltoaLong(scoreC));             // 0x09270 buf110 (누적, long)
  }

  // ── 3구간 0x09284..0x09393  팀 합계 ([0x4D65]!=0 일 때만) ─────────────
  // teamTotal[t] = [0x33f4 + t*0x20] 32비트 (t = 1,2). teamOther[t] = [0x33f8 + t*0x20].
  if (teamMode) {
    const tt = (t        , o        )         => A16(u16(0x33f4 + t * 0x20 + o));
    const ttLo = (t        )         => tt(t, 0), ttHi = (t        )         => tt(t, 2);
    const toLo = (t        )         => tt(t, 4), toHi = (t        )         => tt(t, 6);
    const t1hi = ttHi(1), t1lo = ttLo(1), t2hi = ttHi(2), t2lo = ttLo(2);
    // [bp-0x13] = (teamTotal[2] > teamTotal[1]) ? 2 : 1  (부호 있는 hi, 부호 없는 lo, 동점→1)
    let winner        ;
    if (i16(t2hi) < i16(t1hi)) winner = 1;                          // 0x09299 jl
    else if (i16(t2hi) > i16(t1hi)) winner = 2;                     // 0x0929B jg
    else if (t2lo <= t1lo) winner = 1;                              // 0x092A1 jbe
    else winner = 2;
    s8(0x13, winner);

    for (let t = 1; t <= 2; t++) {                                  // 0x092B3 loop3 (di)
      const total = u32(ttLo(t) | (ttHi(t) << 16));
      const other = u32(toLo(t) | (toHi(t) << 16));
      const qTot = bldiv(total, 10) & 0xffff;
      const qOth = bldiv(other, 10) & 0xffff;
      writeCStr(buf(0xa4, t, 6), ltoaWord(qTot));                   // 0x092E0 bufA4[t] = ltoa(total/10)
      writeCStr(buf(0xec, t, 6), ltoaWord(u16(qTot - qOth)));       // 0x09333 bufEC[t] = ltoa(diff)
    }

    for (let team = 1; team <= 2; team++) {                         // 0x0934B loop4 ([bp-2])
      for (let r = 0; r < tankCount; r++) {                         // di, 순위 순
        const tankIdx = A16(a44(r)) & 0xff;
        if (i16(sbyte(A8(u16(tankRec(tankIdx) + 0x43ff)))) !== team) continue;   // 0x09361 팀 id 바이트
        dg[fbi(0x16, team)] = tankIdx & 0xff;                       // 0x0937E teamRep[team] = tankIdx
        break;                                                      // 0x09380 첫 것에서 끊는다
      }
    }
  }

  // ── 4구간 0x09394..0x0946B  배치 + 팔레트 ────────────────────────────
  const modeSel = ()         => u16(sbyte(dg[0x4d79]) << 2);      // sbyte(mode)*4
  const geomXmax = ()         => A16(u16(0x1241 + modeSel()));   // geomTable[mode] 워드0
  const geomYmax = ()         => A16(u16(0x1243 + modeSel()));   //               워드1

  const bpE = teamMode ? 0x10e : u16(tankCount * 0x50 + 0x6e);   // 0x0939C / 0x093AD
  s16(0xe, bpE);
  // [bp-0xa] = (geomXmax - 39)/2 - bpE/2   (뺀 뒤 나눔)
  const gX = sdiv(u32(i16(u16(geomXmax() + 0xffd9))), 2);        // 0x093C6 idiv 2
  s16(0xa, u16(gX - sdiv(u32(i16(bpE)), 2)));                     // 0x093D4 sub
  // [bp-0xc] = geomYmax/2 - 39   (나눈 뒤 뺌 — X 와 순서 다름)
  s16(0xc, u16(sdiv(u32(i16(geomYmax())), 2) + 0xffd9));         // 0x093EB idiv 2 ; 0x093ED add

  for (let di = 0; di < tankCount; di++) {                       // 0x093F7 loop5
    const col = A8(u16(di + 0x126f));                            // 색표 엔트리 (바이트)
    const dacIdx = u16(sbyte(col) + (sbyte(col) > 7 ? 0x30 : 0)); // 0x093FD jle(부호), *0x30
    const r = A8(u16(0x33ac + i16(sbyte(col)) * 3));             // 팔레트 R (0x33ac + col*3)
    const g = A8(u16(0x33ad + i16(sbyte(col)) * 3));             // G
    const b = A8(u16(0x33ae + i16(sbyte(col)) * 3));             // B
    out({ fn: "palette", index: dacIdx, r, g, b });        // 0x09462 int 0x10 AX=0x1010
  }

  // ── 그리기 도우미 ───────────────────────────────────────────────────
  const gX0 = ()         => gi16(0xa);       // [bp-0xa]  x 기준
  const gY0 = ()         => gi16(0xc);       // [bp-0xc]  y 기준
  // drawString(x, y, strPtr, colour) — 마지막에 밀리는 x 가 첫 인자, colour 는 하위 바이트.
  const drawStr = (x        , y        , strPtr        , colour        )       => {
    out({ fn: "drawString", x: u16(x), y: u16(y), str: readCStr(strPtr), colour: colour & 0xff });
  };
  const bLine = (x1        , y1        , x2        , y2        )       => {
    out({ fn: "line", x1: u16(x1), y1: u16(y1), x2: u16(x2), y2: u16(y2) });
  };
  // geomTable 로 다시 재는 x (0x096C5 등에서 [bp-0xa] 를 안 쓰고 인라인으로 다시 잰다).
  const gxRaw = ()         => sdiv(u32(i16(u16(geomXmax() + 0xffd9))), 2);

  // ── 5구간 0x0946D..0x09A48  점수판 그리기 ────────────────────────────
  const k = dg[0x4d67] === 0 ? 0x1b : 0;                          // (roundsLeft==0 ? 0x1b : 0)
  const X = gX0(), Y = gY0(), E = gi16(0xe);

  out({ fn: "setfillstyle", pattern: 1, colour: 9 });      // 0x09475
  out({ fn: "bar", x1: u16(X), y1: u16(Y - k), x2: u16(X + E), y2: u16(Y + 0x5a) }); // 0x094A1
  out({ fn: "setcolor", colour: 0 });                      // 0x094AC
  out({ fn: "rectangle", x1: u16(X - 3), y1: u16(Y - 3 - k), x2: u16(X + E + 2), y2: u16(Y + 0x5c) }); // 0x094E1
  out({ fn: "setcolor", colour: 0 });                      // 0x094EC
  bLine(X + E + 2, Y + 0x5c, X - 2, Y + 0x5c);                    // 0x09511
  bLine(X + E + 2, Y + 0x5c, X + E + 2, Y - 2 - k);              // 0x0954B
  out({ fn: "setcolor", colour: 7 });                      // 0x09557
  bLine(X - 2, Y - 2 - k, X + E + 2, Y - 2 - k);                 // 0x0959C
  bLine(X - 2, Y - 2 - k, X - 2, Y + 0x5c);                      // 0x095D0
  out({ fn: "setcolor", colour: 0 });                      // 0x095DB
  bLine(X + E + 1, Y + 0x5b, X - 1, Y + 0x5b);                   // 0x095FC
  bLine(X + E + 1, Y + 0x5b, X + E + 1, Y - 1 - k);             // 0x09630
  out({ fn: "setcolor", colour: 7 });                      // 0x0963C
  bLine(X - 1, Y - 1 - k, X + E + 1, Y - 1 - k);                // 0x09679
  bLine(X - 1, Y - 1 - k, X - 1, Y + 0x5b);                     // 0x096A7

  if (dg[0x4d67] === 0) {                                         // 0x096AF  대전 끝일 때만 제목 둘
    drawStr(gxRaw() - 0x2d, Y - 0x11, 0x2374, 7);                // 0x096E2
    drawStr(gxRaw() - 0x2b, Y - 0xf, 0x2384, 0xf);              // 0x09713
  }

  if (!teamMode) {
    // 0x09724  자유전 줄 제목 4개 (x = X+5, y = Y + {0xa,0x19,0x28,0x37})
    drawStr(X + 5, Y + 0xa, 0x2394, 7);
    drawStr(X + 5, Y + 0x19, 0x23a1, 7);
    drawStr(X + 5, Y + 0x28, 0x23b2, 7);
    drawStr(X + 5, Y + 0x37, 0x23c3, 7);
    // 0x0979D  탱크별 열 (di = 순위). x = X + di*0x50 + 0x72.
    for (let di = 0; di < tankCount; di++) {
      const t = A16(a44(di)) & 0xffff;                            // arr44[di] = 탱크색인
      const col = A8(u16(0x126f + t));
      const cx = X + di * 0x50 + 0x72;
      drawStr(cx, Y + 0xa, u16(t * 0x15 + 0x4cc1), col);          // 이름 (슬롯배열+1)
      drawStr(cx, Y + 0x19, buf(0x110, t, 6), col);               // buf110 누적
      drawStr(cx, Y + 0x28, buf(0xc8, t, 6), col);                // bufC8 점수차
      drawStr(cx, Y + 0x37, buf(0x80, t, 6), col);                // buf80 점수/10
    }
  } else {
    // 0x098C0  팀 변형. ds:0x1d3d 의 0xf 바이트를 [bp-0x120] 으로 복사 → 팀 이름 (stride 5).
    for (let i = 0; i < 0xf; i++) dg[u16(FB + FRAME - 0x120 + i)] = dg[u16(0x1d3d + i)]; // 0x1191
    drawStr(X + 5, Y + 0xa, 0x23cf, 7);                           // 0x098EA
    drawStr(X + 5, Y + 0x19, 0x23db, 7);                          // 0x09907
    drawStr(X + 5, Y + 0x28, 0x23e7, 7);                          // 0x09924
    drawStr(X + 5, Y + 0x37, 0x23f8, 7);                          // 0x09941
    for (let bp2 = 1; bp2 <= 2; bp2++) {                          // 0x0994F  [bp-2]
      const di = g8(0x13) === bp2 ? 1 : 2;                        // 이긴 팀 → 1, 진 팀 → 2
      const rep = fbi(0x16, di);                                  // teamRep[di]
      const repIdx = sbyte(dg[rep]);
      const repCol = A8(u16(0x126f + i16(repIdx)));
      const cx = X + bp2 * 0x50 + 0x22;
      drawStr(cx, Y + 0xa, buf(0x120, di, 5), A8(u16(0x127b + di)));         // 팀 이름
      drawStr(cx, Y + 0x19, u16(i16(repIdx) * 0x15 + 0x4cc1), repCol);       // 대표 이름
      drawStr(cx, Y + 0x28, buf(0xec, di, 6), repCol);                       // bufEC 팀 점수차
      drawStr(cx, Y + 0x37, buf(0xa4, di, 6), repCol);                       // bufA4 팀 총점
    }
  }

  // ── 6구간 0x09A4B  남은 라운드 갈림 ─────────────────────────────────
  const rl = dg[0x4d67];
  const slotAbs = (n        )         => A8(u16(0x4cc0 + n * 0x15));   // 0x4cc0 + n*0x15
  const rankTank = (r        )         => A16(a44(r)) & 0xffff;
  const slotOfRank = (r        )         => A8(u16(rankTank(r) * 0x15 + 0x4cc0));
  const score32 = (tankIdx        )         => A32(u16(u16(tankIdx * TANK_STRIDE) + 0x4424));

  if (rl === 0) {
    // ── 6a  0x09A55..0x09E00  슬롯 히스토그램 + 조건 8개 ──────────────
    let cnt5 = 0, cnt5t1 = 0, humanSlot = 0xffff, cnt1 = 0, cnt4 = 0, cnt2 = 0, winHuman = 0;
    for (let si = 0; si < tankCount; si++) {                     // 0x09A7E loop7
      const sl = A8(u16(si * 0x15 + 0x4cc0));
      if (sl === 5 && A8(u16(si * TANK_STRIDE + 0x43ff)) === 1) cnt5t1++;   // 0x09A87
      if (sl === 5) cnt5++;                                                 // 0x09AAA
      if (sl === 1) cnt1++;                                                 // 0x09ABD
      if (sl === 4) cnt4++;                                                 // 0x09AD0
      if (sl === 2) cnt2++;                                                 // 0x09AE3
    }
    if (A8(u16((A16(u16(FB + FRAME - 0x44)) & 0xffff) * 0x15 + 0x4cc0)) === 0) winHuman = 1;  // 0x09AF6 arr44[0] 슬롯==0
    if (teamMode) {                                             // 0x09B0C
      const r1 = sbyte(dg[fbi(0x16, 1)]), r2 = sbyte(dg[fbi(0x16, 2)]);
      if (A8(u16(i16(r1) * 0x15 + 0x4cc0)) === 0) humanSlot = i16(r1) & 0xffff;   // 0x09B25
      if (A8(u16(i16(r2) * 0x15 + 0x4cc0)) === 0) humanSlot = i16(r2) & 0xffff;   // 0x09B3E
    }

    const B = g16(0xc);
    const cell = (a        , c        )       => { out({ fn: "resultCell", a, b: B, c }); };
    const arr0 = A16(a44(0));

    if (cnt4 >= 3 && winHuman !== 0 && sbyte(dg[0x4d68]) >= 0x5a && !teamMode) {
      cell(1, arr0);                                            // 0x09B45 조건1
    } else if (u16(cnt5 - cnt5t1) >= 2 && cnt5t1 >= 1 && humanSlot !== 0xffff
               && dg[0x4d68] === 0x3c && teamMode) {
      cell(3, humanSlot);                                       // 0x09B74 조건2
    } else if (cnt1 === 5 && !teamMode && winHuman !== 0
               && cmp32le(lmul(u32(score32(rankTank(1))), 5), score32(rankTank(0)))) {
      cell(2, arr0);                                            // 0x09BAD 조건3
    } else if (cnt4 >= 1 && winHuman !== 0 && !teamMode && dg[0x4d68] === 0xf
               && A16(u16(rankTank(0) * TANK_STRIDE + 0x4570)) === 0
               && A16(u16(rankTank(1) * TANK_STRIDE + 0x4570)) === 0xf) {
      cell(4, arr0);                                            // 0x09C0D 조건4
    } else if (!teamMode && dg[0x4d68] === 0x1e && cnt4 === 1 && cnt2 === 3
               && dg[0x4d73] === 5
               && A8(u16((A16(a44(4)) & 0xffff) * 0x15 + 0x4cc0)) === 4) {
      cell(5, arr0);                                            // 0x09C5E 조건5
    } else if (!teamMode && winHuman !== 0
               && A8(u16(rankTank(1) * 0x15 + 0x4cc0)) === 0 && cnt5 === 4) {
      cell(6, arr0);                                            // 0x09CA5 조건6
    } else if (!teamMode && winHuman !== 0 && cnt5 >= 2 && cnt4 >= 2 && dg[0x4d68] === 0x2d) {
      cell(7, arr0);                                            // 0x09CDE 조건7
    } else if (teamMode && dg[0x4d68] === 0x2d && g8(0x13) === 1
               && u16(i16(sbyte(slotAbs(0))) + i16(sbyte(slotAbs(1))) + i16(sbyte(slotAbs(2)))) === 2
               && slotAbs(0) !== 2 && slotAbs(1) !== 2 && slotAbs(2) !== 2
               && slotAbs(3) === 5 && slotAbs(4) === 5 && slotAbs(5) === 5) {
      const cVal = u16(((slotAbs(2) === 0 ? 1 : 0) << 1) + (slotAbs(1) === 0 ? 1 : 0));  // 0x09D6B
      cell(8, cVal);                                            // 0x09D13 조건8
    } else {
      // 0x09D9E  기본 "mission completed" 두 줄
      drawStr(gxRaw() - 0x24, g16(0xc) + 0x49, 0x2404, 7);
      drawStr(gxRaw() - 0x22, g16(0xc) + 0x4b, 0x2410, 0xf);
    }
  } else {
    // ── 6b  0x09E03..0x09EED  "라운드 N / M" 진행 글 ──────────────────
    const Y6 = g16(0xc);
    if (rl === 1) {
      drawStr(gxRaw() - 0x2d, Y6 + 0x4b, 0x241c, 0xf);          // 0x09E0A
    } else {
      drawStr(gxRaw() + (rl > 0x63 ? 2 : 0) - 0x70, Y6 + 0x4b, 0x242c, 7);   // 0x09E36
      writeCStr(fa(0x12), ltoaWord(rl));                        // 0x09E7B ltoa(roundsLeft)
      drawStr(gxRaw() + (rl < 0x64 ? 3 : 0) + (rl < 0xa ? 5 : 0) - 0x84, Y6 + 0x4b, fa(0x12), 7);  // 0x09E90
    }
  }

  // ── 마지막 키 읽기 (0x0AC11..0x0AC28) — 여러 갈래가 여기로 뛴다 ──────
  const finalKeyRead = ()            => {
    const finalKey = script.finalKey ?? (port ? port() & 0xff : undefined);
    if (finalKey === undefined) {
      throw new Error("runResultScreen: 마지막 키 읽기(0x0AC14) 도달인데 script.finalKey 없음");
    }
    return { calls, endSeed: seed, draws, ret: finalKey === 0x01 ? 1 : 0 };  // ESC → 1, 아니면 0
  };

  // ── 대기 루프 (0x09F0B / 0x0ABBE 같은 모양) ─────────────────────────
  // 되풀이마다 poll 먼저(첫 되풀이는 churn 없음, 0x09F09 jmp), 그다음 rand churn.
  // churn==0 일 때만 si 감소. 나가는 조건 `si==0 && robotCount==tankCount` 또는 키.
  const M32 = u32(i16(A16(0x4d63)));
  const CAP = 5_000_000;
  const waitLoop = (
    startSi        , schedule                          , sKeyExits = true,
  )         => {
    let si = startSi & 0xffff;
    const robotCount = g8(0x17);
    const tc = tankCount & 0xff;
    for (let iter = 0; ; iter++) {
      let key = 0;                                             // poll: 한 래치, 두세 번 읽음
      if (port) key = port() & 0xff;
      else if (schedule) for (const [at, sc] of schedule) if (iter >= at) key = sc;
      if (key === 0x01 || (sKeyExits && key === 0x1f) || key === 0x39) return key;  // ESC / (S) / SPACE
      if (i16(si) === 0 && robotCount === tc) return 0;        // 0x09F59..0x09F64
      // CAP 은 정답표 시험의 대본(일정)이 키를 안 주는 실수를 잡으려는 것이다. 원본에는 없다 — 사람이 있으면 키가 올 때까지
      // 끝없이 기다린다. 그래서 실제 포트를 읽을 때(readPort)는 걸지 않는다.
      if (!port && iter >= CAP) throw new Error("runResultScreen: 대기 루프가 안 끝난다 (일정에 키 없음?)");
      const churn = bldiv(lmul(u32(draw()), M32), 0x8000) & 0xffff;   // 0x09F0B
      if (churn === 0) {                                       // 0x09F2C or ax,ax; jne
        const dec = i16(si) - 1;
        si = (dec >= 0 ? dec : -(i16(si)) - 1) & 0xffff;       // 0x09F30..0x09F3F
      }
    }
  };

  // ── 7구간 0x09EF0..0x09FF7  첫 키 기다리기 + 나그 + 갈래 ─────────────
  if (rl === 0) out({ fn: "test4d78" });                // 0x09EF7 (roundsLeft==0 일 때만)
  out({ fn: "delay", ms: 0x12c });                      // 0x09EFF delay(300)
  waitLoop(0x9c4, script.wait1);                               // 0x09F0B si=2500

  if (sbyte(dg[0x4d8e]) === 0) {
    // 0x09F6E..0x09FAA  죽은 exit(1) 가드. rand() 한 번을 태우고, `(x==0?1:0)/2` 가
    // 언제나 0 이라 exit 블록(0x09FAC..0x09FCD: textModeRestore/puts/delay/exit)은 안 돈다.
    // 재현할 것은 draw 소비뿐이다.
    const rp = u16(i16(sbyte(dg[0x4d68])) - i16(sbyte(dg[0x4d67])));   // 0x09F7A roundsPlayed
    void bldiv(lmul(u32(draw()), u32(i16(u16(0x78 - rp)))), 0x8000);   // 0x09F89 rand + 계산 (버려짐)
  }

  if (rl !== 0) {                                              // 0x09FCE
    const rpS = i16(sbyte(dg[0x4d68])) - i16(sbyte(dg[0x4d67]));       // 0x09FDA
    if (smod(u32(rpS), 15) !== 0) {                            // 0x09FE9 or dx,dx; je
      const post1 = script.post1 ?? (port ? port() & 0xff : undefined);
      if (post1 === undefined) {
        throw new Error("runResultScreen: 0x09FED 도달인데 script.post1 없음");
      }
      if (post1 !== 0x1f) return finalKeyRead();        // 'S' 아니면 0xAC11 로 뛴다 (세부 화면 건너뜀)
    }
  }
  // 0x09FF8: 8구간으로 떨어진다

  // ── 8구간 0x09FFD..0x0A44C  탱크별 세부 버퍼 계산 (di = 탱크색인) ─────
  const strcpyCStr = (dst        , src        )       => writeCStr(dst, readCStr(src));
  const cat = (idx        )         => u16(idx * CAT_STRIDE + 0x5dc);   // 카탈로그 문자열 자리
  const relAt = (a        , b        )         => u16(u16(a * TANK_STRIDE) + b * 4 + 0x4556); // [rec(a)+b*4+0x4556]

  for (let di = 0; di < tankCount; di++) {
    const tr = u16(di * TANK_STRIDE);
    writeCStr(buf(0x17c, di, 4), ltoaWord(A16(u16(tr + 0x456e))));       // 0x09FFD buf17c
    writeCStr(buf(0x194, di, 4), ltoaWord(A16(u16(tr + 0x4570))));       // 0x0A023 buf194

    // 0x0A049  sum32 = Σ_{j != di} [rec(di) + j*4 + 0x4556]   → buf1e2 = ltoa(sum32/4)
    let sum = 0;
    for (let j = 0; j < tankCount; j++) if (j !== di) sum = u32(sum + A32(relAt(di, j)));
    writeCStr(buf(0x1e2, di, 7), ltoaLong(bldiv(sum, 4)));              // 0x0A0B1 (0x3227)

    // 0x0A0B9  buf1b8 = ltoa( (sum32 / ([rec(di)+0x4552] + 1)) 의 하위 워드 )
    const div1 = u32(A32(u16(tr + 0x4552)) + 1);
    writeCStr(buf(0x1b8, di, 6), ltoaWord(bldiv(sum, div1) & 0xffff));  // 0x0A0F0 (0x31E5)

    // 0x0A0F8  sum32b = Σ_{j != di} [rec(j) + di*4 + 0x4556]  (색인 뒤바뀜)  → buf20c = ltoa(sum32b/4)
    let sumB = 0;
    for (let j = 0; j < tankCount; j++) if (j !== di) sumB = u32(sumB + A32(relAt(j, di)));
    writeCStr(buf(0x20c, di, 7), ltoaLong(bldiv(sumB, 4)));            // 0x0A160 (0x3227)

    // 0x0A168  무기 최대 슬롯 찾기 ([bp-2] = 1..0x34, 필드 +0x447e) → buf164 = 카탈로그 문자열
    let wMaxHi = 0, wMaxLo = 0, wArg = 0;
    for (let s = 1; s <= 0x34; s++) {
      const at = u16(tr + s * 4 + 0x447e);
      const vh = A16(u16(at + 2)), vl = A16(at);
      if (i16(vh) < i16(wMaxHi)) continue;                              // 0x0A193 jl
      if (vh === wMaxHi && vl <= wMaxLo) continue;                      // 0x0A198 jg / 0x0A19D jbe (엄격 초과만)
      wMaxHi = vh; wMaxLo = vl; wArg = s;
    }
    strcpyCStr(buf(0x164, di, 0xe),
      (wMaxHi | wMaxLo) === 0 ? 0x2472 : cat(wArg));                    // 0x0A1F5 (0x3972)

    // 0x0A1FC  천적/봉 찾기: 자기 제외, [rec(di) + j*4 + 0x4556] 의 최대·최소 색인
    let mxHi = 0, mxLo = 0, mxIdx = 0;                                  // maxRel (init 0)
    let mnHi = 3, mnLo = 0xd40, mnIdx = 0;                              // minRel (init 0x00030d40)
    for (let j = 0; j < tankCount; j++) {
      const at = relAt(di, j);
      const vh = A16(u16(at + 2)), vl = A16(at);
      // MAX: val >= maxRel (부호 hi / 무부호 lo) 이고 j != di
      if (!(i16(vh) < i16(mxHi)) && !(vh === mxHi && vl < mxLo) && j !== di) {
        mxIdx = j; mxHi = vh; mxLo = vl;
      }
      // MIN: val < minRel 이고 j != di
      if (!(i16(vh) > i16(mnHi)) && (i16(vh) < i16(mnHi) || vl < mnLo) && j !== di) {
        mnIdx = j; mnHi = vh; mnLo = vl;
      }
    }
    dg[fbi(0x1e, di)] = mxIdx & 0xff;                                   // 0x0A2CC victimArr[di]
    dg[fbi(0x24, di)] = mnIdx & 0xff;                                   // 0x0A2D2 nemesisArr[di]

    // 0x0A2D5  무기 이름 → buf2b4 ; w1 = sbyte([rec(di)+0x4430])
    const w1 = sbyte(A8(u16(tr + 0x4430)));
    strcpyCStr(buf(0x2b4, di, 0xe),
      u16(sbyte(A8(u16(tr + i16(w1) + 0x4445))) * CAT_STRIDE + 0x608)); // 0x0A30C (0x3972)
    stringAppend(dg, buf(0x2b4, di, 0xe), 0x247e);                      // 0x0A327
    writeCStr(fa(0x12), ltoaWord(A16(u16(tr + (i16(w1) << 1) + 0x444d)))); // 0x0A355
    stringAppend(dg, buf(0x2b4, di, 0xe), fa(0x12));                    // 0x0A371

    // 0x0A376  buf260 = ltoa(+0x4419) + "0x2480" + ltoa(+0x441b) + "0x2482" + ltoa(sbyte +0x441d)
    writeCStr(fa(0x12), ltoaWord(A16(u16(tr + 0x4419))));              // 0x0A38B
    strcpyCStr(buf(0x260, di, 0xe), fa(0x12));                          // 0x0A3A5 (0x3972, 첫 쓰기)
    stringAppend(dg, buf(0x260, di, 0xe), 0x2480);                     // 0x0A3C0
    writeCStr(fa(0x12), ltoaWord(A16(u16(tr + 0x441b))));              // 0x0A3DA
    stringAppend(dg, buf(0x260, di, 0xe), fa(0x12));                   // 0x0A3F6
    stringAppend(dg, buf(0x260, di, 0xe), 0x2482);                     // 0x0A40F
    writeCStr(fa(0x12), ltoaWord(sbyte(A8(u16(tr + 0x441d)))));        // 0x0A42B (cwde 된 값)
    stringAppend(dg, buf(0x260, di, 0xe), fa(0x12));                   // 0x0A447
  }

  // ── 9구간 0x0A458..0x0A7F5  세부 화면 그리기 ────────────────────────
  s16(0xe, u16(tankCount * 0x50 + 0x6e));                         // 0x0A458 bpE (팀 확인 없음)
  s16(0xa, u16(sdiv(u32(i16(u16(geomXmax() + 0xffd9))), 2) - sdiv(u32(i16(gi16(0xe))), 2))); // 0x0A47F
  s16(0xc, u16(g16(0xc) - 0x4b));                                 // 0x0A48E [bp-0xc] -= 0x4b

  const X9 = gi16(0xa), Y9 = gi16(0xc), E9 = gi16(0xe);
  out({ fn: "setfillstyle", pattern: 1, colour: 9 });      // 0x0A492
  out({ fn: "bar", x1: u16(X9 - 2), y1: u16(Y9 - 2), x2: u16(X9 + E9 + 2), y2: u16(Y9 + 0xe6) }); // 0x0A4C0
  out({ fn: "setcolor", colour: 0 });                      // 0x0A4C8
  bLine(X9 + E9 + 2, Y9 + 0xe6, X9 - 2, Y9 + 0xe6);              // 0x0A4F0
  bLine(X9 + E9 + 2, Y9 + 0xe6, X9 + E9 + 2, Y9 - 2);           // 0x0A51A
  out({ fn: "setcolor", colour: 7 });                      // 0x0A522
  bLine(X9 - 2, Y9 - 2, X9 + E9 + 2, Y9 - 2);                    // 0x0A54B
  bLine(X9 - 2, Y9 - 2, X9 - 2, Y9 + 0xe6);                      // 0x0A56F
  out({ fn: "setcolor", colour: 0 });                      // 0x0A577
  bLine(X9 + E9 + 1, Y9 + 0xe5, X9 - 1, Y9 + 0xe5);              // 0x0A59B
  bLine(X9 + E9 + 1, Y9 + 0xe5, X9 + E9 + 1, Y9 - 1);           // 0x0A5BF
  out({ fn: "setcolor", colour: 7 });                      // 0x0A5C7
  bLine(X9 - 1, Y9 - 1, X9 + E9 + 1, Y9 - 1);                    // 0x0A5E8
  bLine(X9 - 1, Y9 - 1, X9 - 1, Y9 + 0xe5);                      // 0x0A606

  drawStr(gxRaw() - 0x48, Y9 + 6, 0x2484, 7);                     // 0x0A639
  drawStr(gxRaw() - 0x46, Y9 + 8, 0x249c, 0xf);                   // 0x0A66A
  for (let i = 0; i < 12; i++) {                                  // 0x0A687..0x0A7C6  (0x24b4 + i*0x11)
    drawStr(X9 + 5, Y9 + 0x1e + i * 0xf, u16(0x24b4 + i * 0x11), 0xf);
  }
  drawStr(X9 + 5, Y9 + 0xd2, dg[0x4d67] === 0 ? 0x2580 : 0x2591, 0xf);  // 0x0A7CC / 0x0A7F2

  // 0x0A7FD  loop9 — 탱크별 세부 줄 (di = 순위). x = X9 + di*0x50 + 0x70, y = Y9 + 0x1e + n*0xf.
  const nameAt = (idx        )         => u16(i16(idx) * 0x15 + 0x4cc1);
  const colAt = (idx        )         => A8(u16(0x126f + i16(idx)));
  for (let di = 0; di < tankCount; di++) {
    const t = A16(a44(di)) & 0xffff;                              // arr44[di] = 탱크색인
    const col = A8(u16(0x126f + t));
    const cx = X9 + di * 0x50 + 0x70;
    const row = (n        , strPtr        , colour        )       =>
      drawStr(cx, Y9 + 0x1e + n * 0xf, strPtr, colour);
    const vIdx = sbyte(dg[fbi(0x1e, t)]);                         // victimArr[t]
    const nIdx = sbyte(dg[fbi(0x24, t)]);                         // nemesisArr[t]
    row(0, nameAt(t), col);                                       // 슬롯 이름
    row(1, buf(0x260, t, 0xe), col);
    row(2, buf(0x2b4, t, 0xe), col);
    row(3, buf(0x164, t, 0xe), col);
    row(4, buf(0x1e2, t, 7), col);
    row(5, buf(0x20c, t, 7), col);
    row(6, buf(0x1b8, t, 6), col);
    row(7, buf(0x17c, t, 4), col);
    row(8, nameAt(vIdx), colAt(vIdx));                            // 봉 (victim)
    row(9, nameAt(nIdx), colAt(nIdx));                            // 천적 (nemesis)
    row(10, buf(0x194, t, 4), col);
    row(11, buf(0x110, t, 6), col);
    row(12, buf(0x80, t, 6), col);
  }

  // ── 10구간 0x0ABAF..0x0AC28  둘째 키 기다리기 + 마지막 키 → 반환 ─────
  out({ fn: "delay", ms: 0x12c });                      // 0x0ABAF delay(300)
  waitLoop(0x1d4c, script.wait2, false);                       // 0x0ABBE si=7500, 'S' 는 안 나감
  return finalKeyRead();                                       // 0x0AC11 마지막 in al,0x60 → AL
}

/** 32비트 부호 있는 hi / 부호 없는 lo 로 `a <= b` (0x09BEA..0x09BF7 의 비교 모양). */
function cmp32le(a        , b        )          {
  const ah = i16((a >>> 16) & 0xffff), bh = i16((b >>> 16) & 0xffff);
  if (ah > bh) return false;          // 0x09BEF jg → 건너뜀
  if (ah !== bh) return true;         // 0x09BF1 jne (즉 ah < bh) → 취함
  return (a & 0xffff) <= (b & 0xffff);   // 0x09BF7 ja → 건너뜀 (부호 없는 lo)
}

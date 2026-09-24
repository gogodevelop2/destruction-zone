// 원본 DZONE.EXE 의 선 탐침 재구현.
//
//   0x046CA  방향을 갈라 두 일꾼 중 하나로 보낸다 (line-probe-dispatch)
//   0x04460  x 가 긴 쪽일 때 걷는다 (line-probe-x-major)
//   0x0459B  y 가 긴 쪽일 때 걷는다 (line-probe-y-major)
//   0x08F99  사각형이 비었는지 가로선으로 훑는다 (is-rectangle-clear)
//
// 이 함수들은 인자만으로 답이 정해지지 않는다. 걸음마다 화면의 색을 읽어
// 받아들일 색 목록에 있는지 본다. 그래서 화면을 Screen 으로 받는다.
// 정답표: goldens/line_probe_vectors_v1/
// @원본 0x04460 0x0459B 0x046CA 0x08F99

                         
                                                       
                                         
                                                   
                                  
                                          
 

const i16 = (v        )         => (v << 16) >> 16;
const u16 = (v        )         => v & 0xffff;
const cbw = (b        )         => (b << 24) >> 24;   // 바이트를 부호 있는 16비트로

// 받아들이는 색인가. 두 일꾼이 이 판정을 서로 다르게 한다 — 아래 주석 참고.
function acceptedWord(got        , count        , c1        , c2        , c3        )          {
  // x 일꾼은 getpixel 이 준 16비트 값을 그대로 두고, 받아들일 색 바이트를
  // 부호 확장해서 비교한다. 그래서 0x80 이상인 색은 어떤 화면 값과도 안 맞는다.
  if (count === 2) return cbw(c1) === i16(got) || cbw(c2) === i16(got);
  if (count === 1) return cbw(c1) === i16(got);
  if (count === 3) return cbw(c1) === i16(got) || cbw(c2) === i16(got) || cbw(c3) === i16(got);
  throw new Error(`선 탐침: 받아들일 색 개수가 ${count} 다. 원본은 여기서 exit(1) 로 프로그램을 끝낸다`);
}

function acceptedByte(got        , count        , c1        , c2        , c3        )          {
  // y 일꾼은 getpixel 결과의 하위 바이트만 남겨 바이트끼리 비교한다.
  const b = got & 0xff;
  if (count === 2) return b === (c1 & 0xff) || b === (c2 & 0xff);
  if (count === 1) return b === (c1 & 0xff);
  if (count === 3) return b === (c1 & 0xff) || b === (c2 & 0xff) || b === (c3 & 0xff);
  throw new Error(`선 탐침: 받아들일 색 개수가 ${count} 다. 원본은 여기서 exit(1) 로 프로그램을 끝낸다`);
}

// 0x04460 — x 가 긴 쪽. x 는 걸음마다, y 는 오차항이 0 이상일 때만 움직인다.
// 돌려주는 값은 바이트다. 0xFF 는 "끝까지 다 받아들이는 색이었다" 는 뜻이다.
export function probeXMajor(
  s        , x        , y        , adx        , ady        ,
  xstep        , ystep        , count        , c1        , c2        , c3        ,
)         {
  const twoDy = i16(ady * 2);
  const twoDyMinusTwoDx = i16(twoDy - i16(adx * 2));
  let err = i16(twoDy - adx);
  let n = u16(adx);
  let got = s.getPixel(x, y);
  for (;;) {
    if (!acceptedWord(got, count, c1, c2, c3)) return got & 0xff;
    if (n === 0) return 0xff;
    n = u16(n - 1);
    if (err >= 0) { y = i16(y + cbw(ystep)); err = i16(err + twoDyMinusTwoDx); }
    else { err = i16(err + twoDy); }
    x = i16(x + cbw(xstep));
    got = s.getPixel(x, y);
  }
}

// 0x0459B — y 가 긴 쪽. 위와 대칭인데, 색 판정만 바이트끼리 한다.
export function probeYMajor(
  s        , x        , y        , adx        , ady        ,
  xstep        , ystep        , count        , c1        , c2        , c3        ,
)         {
  const twoDx = i16(adx * 2);
  const twoDxMinusTwoDy = i16(twoDx - i16(ady * 2));
  let err = i16(twoDx - ady);
  let n = u16(ady);
  let got = s.getPixel(x, y) & 0xff;
  for (;;) {
    if (!acceptedByte(got, count, c1, c2, c3)) return got & 0xff;
    if (n === 0) return 0xff;
    n = u16(n - 1);
    if (err >= 0) { x = i16(x + cbw(xstep)); err = i16(err + twoDxMinusTwoDy); }
    else { err = i16(err + twoDx); }
    y = i16(y + cbw(ystep));
    got = s.getPixel(x, y) & 0xff;
  }
}

// 0x046CA — 두 점 사이를 훑는다. 돌려주는 값은 바이트다.
// 0xFF 면 선 위의 모든 점이 받아들이는 색이었다는 뜻이고, 아니면 처음 걸린 색이다.
export function probe(
  s        , x1        , y1        , x2        , y2        ,
  count        , c1        , c2        , c3        ,
)         {
  // 원본은 여기서 VGA 그래픽 컨트롤러의 Set/Reset 을 0, Enable Set/Reset 을 0x0F 로 둔다.
  // 이 함수는 픽셀을 하나도 쓰지 않으므로 읽기에는 영향이 없다.
  s.out?.(0x3ce, 0x00); s.out?.(0x3cf, 0x00);
  s.out?.(0x3ce, 0x01); s.out?.(0x3cf, 0x0f);

  let dx = i16(x2 - x1);
  let dy = i16(y2 - y1);
  let ystep = 1;
  if (dy <= 0) { dy = i16(-dy); ystep = 0xff; }     // dy 가 0 이어도 이쪽으로 온다
  let xstep = 1;
  if (dx <= 0) { dx = i16(-dx); xstep = 0xff; }
  const args = [s, x1, y1, dx, dy, xstep, ystep, count, c1, c2, c3]         ;
  // 긴 쪽이 일꾼을 정한다. 같으면 y 쪽으로 간다.
  const r = dx <= dy ? probeYMajor(...args) : probeXMajor(...args);

  if (cbw(r) < 0) {
    // 다 받아들이는 색이었을 때만 원본이 컨트롤러를 되돌린다.
    // 막힌 채로 돌아가는 길에는 Enable Set/Reset 이 0x0F 인 채로 남는다.
    s.out?.(0x3ce, 0x01); s.out?.(0x3cf, 0x00);
    s.out?.(0x3ce, 0x08); s.out?.(0x3cf, 0xff);
    return 0xff;
  }
  return r;
}

// 0x08F99 — 사각형이 비었는지. 사방으로 10 만큼 넓힌 뒤 10 간격의 가로선만 훑는다.
// 돌려주는 값은 부호 있는 16비트다. -1 이면 비었다는 뜻이다.
//
// 10 간격이라 두께가 10 보다 얇은 것은 줄 사이로 빠져나간다. 모든 줄을 훑도록
// 고치면 원본이 받아들이던 배치를 물리게 되고, 배치의 성패가 다음 난수 호출로
// 이어지므로 경기장 전체가 달라진다. 간격을 그대로 두어야 한다.
export function isRectangleClear(
  s        , x1        , y1        , x2        , y2        ,
)         {
  const left = i16(x1 - 10);
  const top = i16(y1 - 10);
  const right = i16(x2 + 10);
  const bottom = i16(y2 + 10);
  let r                = null;
  for (let y = top; y <= bottom; y = i16(y + 10)) {
    r = cbw(probe(s, left, y, right, y, 1, 8, 0, 0));
    if (r !== -1) return r;
  }
  if (r === null) {
    throw new Error(
      `isRectangleClear: 가로선을 한 줄도 안 훑었다 (y ${y1}..${y2}). ` +
      `원본은 이때 초기화 안 된 스택 값을 돌려주므로 재현할 수 없다.`,
    );
  }
  return r;
}

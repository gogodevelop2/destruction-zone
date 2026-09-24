// 원본 DZONE.EXE 의 사인(이미지 0x137C5)·코사인(0x1383A) 재구현.
//
// 각도 단위는 1/50 도다. 한 바퀴가 18000 이고 사분면 하나가 4500 이다.
// 결과는 사인·코사인 값의 1000배인 정수다.
//
// 표의 값은 진짜 사인과 최대 1.9% 어긋난다. 46개 중 7개가 round(1000*sin) 과
// 다르고, 특히 32도 자리는 530 이어야 할 것이 520 이다. 이 표가 게임의 모든
// 회전과 탄도에 들어가므로 Math.sin 으로 대신하면 즉시 원본과 갈린다.
// 정답표: goldens/trig_vectors_v1/
// @원본 0x137C5 0x1383A

// DGROUP 0x12DB 의 46워드. 2도마다 하나이고 0도부터 90도까지다.
export const SINE_TABLE                    = [
  1, 35, 70, 105, 139, 174, 208, 242, 276, 309, 342, 375,
  407, 438, 470, 500, 520, 559, 589, 616, 643, 669, 695, 719,
  743, 766, 788, 809, 829, 848, 866, 883, 899, 914, 927, 940,
  951, 961, 970, 978, 985, 990, 995, 997, 998, 999,
];

// 원본이 표 안에 머무는 각도 범위. 이 밖에서는 표 앞뒤의 DGROUP 을 읽는다.
export const ANGLE_MIN = 0;
export const ANGLE_MAX = 18099;

function checkDomain(angle        , who        )       {
  if (!Number.isInteger(angle) || angle < ANGLE_MIN || angle > ANGLE_MAX) {
    throw new RangeError(
      `${who}: 각도 ${angle} 는 원본이 표 안에 머무는 범위 ${ANGLE_MIN}..${ANGLE_MAX} 밖이다. ` +
      `원본은 여기서 표 밖의 DGROUP 을 읽는다 — 부르는 쪽이 각도를 먼저 줄여야 한다.`,
    );
  }
}

export function sine(angle        )         {
  checkDomain(angle, "sine");
  if (angle <= 4500) return SINE_TABLE[(angle / 100) | 0];
  if (angle <= 9000) return SINE_TABLE[45 - (((angle - 4500) / 100) | 0)];
  if (angle <= 13500) return -SINE_TABLE[((angle - 9000) / 100) | 0];
  return -SINE_TABLE[45 - (((angle - 13500) / 100) | 0)];
}

export function cosine(angle        )         {
  checkDomain(angle, "cosine");
  if (angle <= 4500) return SINE_TABLE[45 - ((angle / 100) | 0)];
  if (angle <= 9000) return -SINE_TABLE[((angle - 4500) / 100) | 0];
  if (angle <= 13500) return -SINE_TABLE[45 - (((angle - 9000) / 100) | 0)];
  return SINE_TABLE[((angle - 13500) / 100) | 0];
}

// 브라우저에서 node:fs·node:url 을 대신한다. 옮긴 코드 몇이 모듈을 올릴 때 rom/ 의 파일(DZONE.EXE 따위)을
// readFileSync 로 읽는다. 작업 스레드가 게임 모듈을 올리기 전에 setFiles 로 파일을 넣어 두고, 이름(끝 조각)으로 돌려준다.
const files = new Map                    ();

export function setFiles(f                            )       {
  for (const [k, v] of Object.entries(f)) files.set(k.toUpperCase(), v);
}

export function readFileSync(p              , enc         )                      {
  const name = String(p).split("/").pop() .toUpperCase();
  const b = files.get(name);
  if (!b) throw new Error(`ENOENT: ${name}`);
  return enc ? new TextDecoder().decode(b) : b;
}

export const fileURLToPath = (u              )         => String(u);

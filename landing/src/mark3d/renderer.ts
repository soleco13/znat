/**
 * Объёмный знак «Матис» на чистом WebGL, без 3D-движка.
 *
 * Геометрия — та же, что у знака на сайте (apps/web/src/shared/ui/brand-mark.tsx):
 * диск r 162.5, центральный вырез r 72 и «спутник» r 44, прорезающий верхний край.
 * Форма задана функцией расстояния (SDF): двумерный контур, выдавленный на
 * толщину со скруглёнными кромками, и рисуется трассировкой лучей во
 * фрагментном шейдере. Так вырезы можно двигать прямо в шейдере — это и есть
 * основное движение: «перетекание» из фирменного лоадера приложения
 * (apps/web/src/shared/ui/loader.tsx): большой вырез уходит к краю и
 * сжимается, малый растёт к центру, диск поворачивается на пол-оборота — и
 * знак снова в исходном виде.
 *
 * Вспомогательное движение — наклон за курсором. Кадр рисуется только когда
 * что-то меняется: в покое (между «перетеканиями», без движения мыши) GPU не
 * работает.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform mat3 uRot;
uniform vec4 uHoles;
uniform float uSpin;

const float H = 0.135;
const float RR = 0.035;
const float CAM = 4.2;
const float FOCAL = 2.9;

vec2 spin(vec2 p) {
  float c = cos(uSpin), s = sin(uSpin);
  return vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
}

float shape2(vec2 p) {
  float d = length(p) - 1.0;
  d = max(d, -(length(p - vec2(0.0, uHoles.x)) - uHoles.y));
  d = max(d, -(length(p - vec2(0.0, uHoles.z)) - uHoles.w));
  return d;
}

float map(vec3 p) {
  float d2 = shape2(spin(p.xy)) + RR;
  vec2 w = vec2(d2, abs(p.z) - H + RR);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - RR;
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0012;
  return normalize(
    k.xyy * map(p + k.xyy * e) +
    k.yyx * map(p + k.yyx * e) +
    k.yxy * map(p + k.yxy * e) +
    k.xxx * map(p + k.xxx * e));
}

/* Студия: светлый потолок, тёмный пол, большой софтбокс слева сверху и узкий
   стрип справа — от них блики на лицевой стороне и на скруглённых кромках. */
vec3 env(vec3 d) {
  vec3 col = mix(vec3(0.16, 0.18, 0.23), vec3(0.92, 0.94, 0.97), smoothstep(-0.55, 0.75, d.y));
  vec3 key = normalize(vec3(-0.6, 0.62, 0.5));
  col += vec3(2.6) * smoothstep(0.86, 0.95, dot(d, key));
  vec3 strip = normalize(vec3(0.95, 0.05, 0.3));
  float sx = smoothstep(0.93, 0.975, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(strip.x, 0.0, strip.z))));
  col += vec3(1.3) * sx * smoothstep(0.55, 0.2, abs(d.y - 0.05));
  return col;
}

float ao(vec3 p, vec3 n) {
  float occ = 0.0;
  float w = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.025 * float(i);
    occ += (h - map(p + n * h)) * w;
    w *= 0.6;
  }
  return clamp(1.0 - 3.2 * occ, 0.0, 1.0);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, CAM);
  vec3 rd = normalize(vec3(uv, -FOCAL));

  /* В систему координат знака: uRot — поворот мира в объект. */
  vec3 o = uRot * ro;
  vec3 r = uRot * rd;

  /* Только лучи, попадающие в описанную сферу, — остальное прозрачно. */
  float b = dot(o, r);
  float c = dot(o, o) - 1.03;
  float disc = b * b - c;
  if (disc < 0.0) { gl_FragColor = vec4(0.0); return; }
  float sq = sqrt(disc);
  float t = max(-b - sq, 0.0);
  float tEnd = -b + sq;

  /* Угловой размер пикселя: на столько луч может «промахнуться» мимо края. */
  float px = 2.0 / (min(uRes.x, uRes.y) * FOCAL);
  float minD = 1e3;
  float tMin = t;
  bool hit = false;
  for (int i = 0; i < 80; i++) {
    float d = map(o + r * t);
    float a = d / t;
    if (a < minD) { minD = a; tMin = t; }
    if (d < 0.0005 * t) { hit = true; break; }
    t += d;
    if (t > tEnd) break;
  }

  /* Сглаживание силуэта: луч, прошедший вплотную к краю, даёт полупрозрачный пиксель. */
  float alpha = hit ? 1.0 : 1.0 - smoothstep(0.0, px * 1.5, minD);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }
  if (!hit) t = tMin;

  vec3 p = o + r * t;
  vec3 n = normalAt(p);
  vec3 v = -r;

  /* Фирменный синий #1d4ed8 в линейном пространстве. */
  vec3 albedo = vec3(0.0123, 0.0782, 0.687);
  vec3 key = normalize(vec3(-0.6, 0.62, 0.5));
  /* Свет задан в мире, нормали — в объекте: переводим свет тем же поворотом. */
  vec3 keyO = uRot * key;
  vec3 fillO = uRot * normalize(vec3(0.7, -0.15, 0.7));
  vec3 upO = uRot * vec3(0.0, 1.0, 0.0);

  float occ = ao(p, n);
  float dif = max(dot(n, keyO), 0.0);
  float fil = max(dot(n, fillO), 0.0);
  float sky = 0.5 + 0.5 * dot(n, upO);
  vec3 col = albedo * (1.55 * dif + 0.45 * fil + 0.55 * sky) * occ;

  /* Лак: отражение студии по Френелю и тугой блик софтбокса. */
  vec3 refl = reflect(-v, n);
  /* env() задан в мировых осях — отражённый луч переводим из объекта обратно. */
  vec3 reflW = refl * uRot;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col = col * (1.0 - fres) + env(reflW) * fres * occ;
  vec3 h = normalize(keyO + v);
  col += vec3(0.9) * pow(max(dot(n, h), 0.0), 180.0) * occ;

  col = aces(col * 1.15);
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col * alpha, alpha);
}
`;

/**
 * Геометрия знака в долях радиуса диска (325×325 → r = 1) — как на сайте и в
 * приложении (apps/web/src/shared/ui/brand-mark.tsx, favicon.svg): центральный
 * вырез r 72, «спутник» r 44 с центром у края (cy 14) прорезает верх диска.
 */
const R = 162.5;
const BIG = { y: 0, r: 72 / R };
const SMALL = { y: (R - 14) / R, r: 44 / R };

export type MarkRendererOptions = {
  /** Без анимации: один кадр в исходной позе. */
  still: boolean;
  /** Предел плотности пикселей (на телефоне меньше). */
  maxDpr: number;
};

export type MarkRenderer = {
  /** Наклон за курсором, -1…1 по осям. */
  setPointer(x: number, y: number): void;
  setActive(active: boolean): void;
  resize(): void;
  destroy(): void;
};

const smooth = (u: number) => u * u * (3 - 2 * u);
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

/** Цикл: покой, затем «перетекание» вырезов. */
const REST_MS = 6200;
const FLOW_MS = 2600;
/** Первое перетекание — вскоре после появления, чтобы движение заметили. */
const FIRST_FLOW_AT = 2200;
const INTRO_MS = 1400;

/** Базовый ракурс: чуть сверху и на три четверти — видна толщина. */
const BASE_X = -0.16;
const BASE_Y = 0.36;

function rotation(ax: number, ay: number): Float32Array {
  // Поворот мира в объект: (Ry(ay) · Rx(ax))ᵀ, по столбцам — как ждёт uniformMatrix3fv.
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  // M = Ry · Rx (объект → мир), строки:
  const m = [
    [cy, sy * sx, sy * cx],
    [0, cx, -sx],
    [-sy, cy * sx, cy * cx],
  ];
  // Транспонированная M по столбцам = строки M.
  return new Float32Array([m[0]![0]!, m[0]![1]!, m[0]![2]!, m[1]![0]!, m[1]![1]!, m[1]![2]!, m[2]![0]!, m[2]![1]!, m[2]![2]!]);
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) throw new Error("shader");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log ?? "shader");
  }
  return s;
}

/** Бросает исключение, если WebGL недоступен, — вызывающий показывает плоский знак. */
export function createMarkRenderer(canvas: HTMLCanvasElement, opts: MarkRendererOptions, onLost: () => void): MarkRenderer {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    // Без видеокарты (программный рендеринг, старые ПК) шейдер грузит ядро процессора
    // почти на 100 % в каждом перетекании — браузер вернёт null, покажем плоский знак.
    failIfMajorPerformanceCaveat: true,
    // Статичный режим рисует один кадр — он не должен пропасть при перекомпоновке страницы.
    preserveDrawingBuffer: opts.still,
  });
  if (!gl) throw new Error("webgl");
  // Программный рендеринг (SwiftShader, llvmpipe и т. п.) браузер иногда не считает «серьёзной
  // потерей» — проверяем сами: на таком устройстве сцена съедала бы ядро процессора.
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) throw new Error("software_gl");

  const prog = gl.createProgram();
  if (!prog) throw new Error("program");
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uRot = gl.getUniformLocation(prog, "uRot");
  const uHoles = gl.getUniformLocation(prog, "uHoles");
  const uSpin = gl.getUniformLocation(prog, "uSpin");

  let lost = false;
  const onContextLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    stop();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  /** Доля разрешения: падает, если кадры не успевают (слабая видеокарта). */
  let quality = 1;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr) * quality;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    dirty = true;
    schedule();
  };

  // Состояние движения. Часы цикла идут только пока сцена видна: после паузы
  // (вкладка скрыта, сцена ушла с экрана) движение продолжается с того же места.
  let target = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  let active = true;
  let raf = 0;
  let idleTimer = 0;
  let dirty = true;
  let origin = -1;
  let pausedAt = -1;
  let last = 0;
  const slow: number[] = [];
  const CYCLE = REST_MS + FLOW_MS;
  const clockAt = (now: number) => now - origin;

  /** Доля «перетекания» (0…1) и число завершённых циклов на момент `clock`. */
  const flowAt = (clock: number) => {
    const c = clock - (FIRST_FLOW_AT - REST_MS);
    if (c < 0) return { n: 0, u: 0 };
    const n = Math.floor(c / CYCLE);
    const u = (c - n * CYCLE - REST_MS) / FLOW_MS;
    return { n, u: Math.max(0, Math.min(1, u)) };
  };

  const draw = (now: number) => {
    if (origin < 0) origin = now;
    const clock = opts.still ? 0 : clockAt(now);
    const dt = last ? Math.min(now - last, 64) : 16;
    last = now;
    let moving = false;

    // Перетекание: большой вырез уходит к краю и сжимается, малый растёт к
    // центру (малый — с запаздыванием, чтобы перемычка между ними не исчезала),
    // диск поворачивается на пол-оборота — и знак снова в исходном виде.
    let f = 0;
    let spinA = 0;
    if (!opts.still) {
      const { u } = flowAt(clock);
      if (u > 0 && u < 1) moving = true;
      f = easeInOut(u);
      // Вырезы в конце (f = 1) — исходный знак, повёрнутый на π: пол-оборота
      // диска возвращает его в каноническую позу, «спутник» снова сверху.
      spinA = f * Math.PI;
    }
    const g = smooth(f);
    const big = { y: BIG.y - SMALL.y * f, r: BIG.r + (SMALL.r - BIG.r) * g };
    const small = { y: SMALL.y * (1 - f), r: SMALL.r + (BIG.r - SMALL.r) * Math.pow(g, 1.4) };

    // Появление: разворот из ракурса сбоку к базовому.
    const intro = opts.still ? 1 : Math.min(1, clock / INTRO_MS);
    if (intro < 1) moving = true;
    const introE = easeOut(intro);

    // Наклон за курсором — с запаздыванием.
    const k = 1 - Math.pow(0.0025, dt / 1000);
    tilt.x += (target.x - tilt.x) * k;
    tilt.y += (target.y - tilt.y) * k;
    if (Math.abs(target.x - tilt.x) > 0.0005 || Math.abs(target.y - tilt.y) > 0.0005) moving = true;

    const ax = BASE_X + tilt.y * 0.16;
    const ay = BASE_Y - (1 - introE) * 0.9 + tilt.x * 0.22;

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniformMatrix3fv(uRot, false, rotation(ax, ay));
    gl.uniform4f(uHoles, big.y, big.r, small.y, small.r);
    gl.uniform1f(uSpin, spinA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Не успевает 40 кадров в секунду — снижаем разрешение (до половины).
    if (moving) {
      slow.push(dt);
      if (slow.length > 24) slow.shift();
      const avg = slow.reduce((a, b) => a + b, 0) / slow.length;
      if (slow.length === 24 && avg > 25 && quality > 0.55) {
        quality = Math.max(0.5, quality - 0.25);
        slow.length = 0;
        resize();
      }
    }
    return { moving, clock };
  };

  const loop = (now: number) => {
    raf = 0;
    if (lost || !active) return;
    const { moving, clock } = draw(now);
    dirty = false;
    if (opts.still) return;
    if (moving) {
      raf = requestAnimationFrame(loop);
      return;
    }
    // Покой: GPU не работает до начала следующего перетекания.
    last = 0;
    const { n } = flowAt(clock);
    // В покое цикла n его перетекание ещё впереди: начало — FIRST_FLOW_AT + n·CYCLE.
    const nextFlow = FIRST_FLOW_AT + n * CYCLE;
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      schedule();
    }, Math.max(16, nextFlow - clock));
  };

  const schedule = () => {
    if (lost || !active || raf) return;
    if (opts.still && !dirty) return;
    if (idleTimer) {
      window.clearTimeout(idleTimer);
      idleTimer = 0;
    }
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    if (idleTimer) window.clearTimeout(idleTimer);
    raf = 0;
    idleTimer = 0;
    last = 0;
  };

  resize();

  return {
    setPointer(x, y) {
      if (opts.still) return;
      target = { x, y };
      schedule();
    },
    setActive(a) {
      if (a === active) return;
      active = a;
      const now = performance.now();
      if (!a) {
        pausedAt = now;
        stop();
        return;
      }
      // Время паузы не считается: сдвигаем начало отсчёта.
      if (pausedAt >= 0 && origin >= 0) origin += now - pausedAt;
      pausedAt = -1;
      dirty = true;
      schedule();
    },
    resize,
    destroy() {
      stop();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}

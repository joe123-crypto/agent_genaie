import Image from "next/image";

type Building = {
  x: number;
  w: number;
  top: number;
  cap?: "flat" | "dome" | "point" | "box";
  antenna?: number;
  cols?: number;
};

const GROUND = 486;

const buildings: Building[] = [
  { x: 18, w: 92, top: 296, cap: "box", cols: 3 },
  { x: 96, w: 60, top: 356, cap: "flat", cols: 2 },
  { x: 150, w: 96, top: 250, cap: "dome", cols: 3 },
  { x: 250, w: 74, top: 336, cap: "flat", cols: 2 },
  { x: 322, w: 74, top: 176, cap: "point", antenna: 118, cols: 2 },
  { x: 402, w: 60, top: 300, cap: "point", antenna: 54, cols: 2 },
  { x: 460, w: 98, top: 250, cap: "dome", cols: 3 },
  { x: 560, w: 56, top: 322, cap: "flat", cols: 2 },
  { x: 612, w: 56, top: 284, cap: "box", cols: 2 },
];

function BuildingShape({ b }: { b: Building }) {
  const { x, w, top } = b;
  const right = x + w;
  const cx = x + w / 2;

  // Roof / cap geometry
  let roof: React.ReactNode = null;
  let bodyTop = top;

  if (b.cap === "dome") {
    bodyTop = top;
    roof = (
      <path
        className="hero-city-line"
        d={`M${x} ${top} a${w / 2} ${w / 2} 0 0 1 ${w} 0`}
      />
    );
  } else if (b.cap === "point") {
    bodyTop = top;
    roof = (
      <path
        className="hero-city-line"
        d={`M${x} ${top} L${cx} ${top - 34} L${right} ${top}`}
      />
    );
  } else if (b.cap === "box") {
    bodyTop = top;
    roof = (
      <path
        className="hero-city-line"
        d={`M${x + 14} ${top} L${x + 14} ${top - 16} L${right - 14} ${top - 16} L${right - 14} ${top}`}
      />
    );
  }

  // Window columns (dashed vertical lines)
  const cols = b.cols ?? 2;
  const gap = w / (cols + 1);
  const windows = Array.from({ length: cols }, (_, i) => {
    const wx = x + gap * (i + 1);
    return (
      <line
        key={i}
        className="hero-city-window"
        x1={wx}
        y1={bodyTop + 22}
        x2={wx}
        y2={GROUND - 12}
      />
    );
  });

  return (
    <g>
      {b.antenna ? (
        <line
          className="hero-city-line"
          x1={cx}
          y1={b.cap === "point" ? top - 34 : top}
          x2={cx}
          y2={(b.cap === "point" ? top - 34 : top) - b.antenna}
        />
      ) : null}
      {roof}
      <path
        className="hero-city-line"
        d={`M${x} ${GROUND} L${x} ${bodyTop} M${right} ${bodyTop} L${right} ${GROUND}`}
      />
      {windows}
    </g>
  );
}

function Robot() {
  return (
    <g className="hero-robot-group">
      {/* soft ground shadow */}
      <ellipse
        className="hero-shadow"
        cx="300"
        cy="492"
        rx="150"
        ry="12"
      />

      {/* backpack (behind body) */}
      <path
        className="hero-robot-line"
        d="M366 350
           C404 348 424 366 424 396
           C424 424 408 440 380 440
           L360 440 Z"
        fill="#ffffff"
      />
      <path
        className="hero-robot-line"
        d="M400 372 h14 M400 392 h14"
        fill="none"
      />

      {/* legs */}
      <path
        className="hero-robot-line"
        d="M252 448 v22 M292 448 v22 M312 448 v22 M352 448 v22"
        fill="none"
      />
      {/* feet */}
      <path
        className="hero-robot-line"
        d="M236 470 h58 a14 14 0 0 1 0 24 h-58 a14 14 0 0 1 0 -24 Z"
        fill="#ffffff"
      />
      <path
        className="hero-robot-line"
        d="M310 470 h58 a14 14 0 0 1 0 24 h-58 a14 14 0 0 1 0 -24 Z"
        fill="#ffffff"
      />

      {/* torso */}
      <path
        className="hero-robot-line"
        d="M226 344
           C214 344 206 356 206 372
           L206 430
           C206 448 220 460 244 460
           L356 460
           C380 460 394 448 394 430
           L394 372
           C394 356 386 344 374 344
           C360 336 240 336 226 344 Z"
        fill="#ffffff"
      />
      {/* chest plate */}
      <path
        className="hero-robot-line"
        d="M244 366
           C236 366 232 372 232 380
           L232 420
           C232 432 240 438 252 438
           L348 438
           C360 438 368 432 368 420
           L368 380
           C368 372 364 366 356 366 Z"
        fill="#ffffff"
      />
      {/* chest detail: center seam + light */}
      <line className="hero-robot-line" x1="300" y1="366" x2="300" y2="438" />
      <circle className="hero-robot-line" cx="300" cy="392" r="9" fill="#ffffff" />
      <path className="hero-robot-line" d="M258 414 h20 M322 414 h20" fill="none" />

      {/* right arm (viewer right) reaching down the outside to the case handle */}
      <path
        className="hero-robot-line"
        d="M392 386
           C416 394 426 412 421 428
           C429 436 440 438 450 436"
        fill="none"
      />
      {/* right hand gripping the handle */}
      <ellipse
        className="hero-robot-line"
        cx="458"
        cy="434"
        rx="12"
        ry="10"
        fill="#ffffff"
      />

      {/* left arm (viewer left) bent, holding envelope */}
      <path
        className="hero-robot-line"
        d="M210 372
           C186 380 172 398 176 420
           C178 432 188 438 200 434"
        fill="#ffffff"
      />
      {/* left hand gripping envelope */}
      <path
        className="hero-robot-line"
        d="M188 402
           a16 14 0 1 0 0.1 0 Z"
        fill="#ffffff"
      />

      {/* neck */}
      <path
        className="hero-robot-line"
        d="M270 330 v14 M330 330 v14"
        fill="none"
      />

      {/* head / helmet */}
      <path
        className="hero-robot-line"
        d="M300 214
           C246 214 224 250 224 288
           C224 320 250 342 300 342
           C350 342 376 320 376 288
           C376 250 354 214 300 214 Z"
        fill="#ffffff"
      />
      {/* cap crest */}
      <path
        className="hero-robot-line"
        d="M262 226
           C250 206 262 190 288 192
           C280 202 276 214 284 224 Z"
        fill="#ffffff"
      />
      {/* face visor */}
      <path
        className="hero-robot-line"
        d="M256 262
           C256 250 266 244 280 244
           L320 244
           C334 244 344 250 344 262
           C344 278 332 288 316 288
           L284 288
           C268 288 256 278 256 262 Z"
        fill="#ffffff"
      />
      {/* eyes */}
      <ellipse className="hero-robot-eye" cx="284" cy="266" rx="7" ry="10" />
      <ellipse className="hero-robot-eye" cx="316" cy="266" rx="7" ry="10" />
      {/* smile */}
      <path
        className="hero-robot-line"
        d="M286 306 C296 314 304 314 314 306"
        fill="none"
      />

      {/* ---- envelope with letters (held in left hand) ---- */}
      {/* papers poking out the top */}
      <path
        className="hero-robot-line"
        d="M150 350
           L214 342
           L220 384
           L156 392 Z"
        fill="#ffffff"
      />
      <path className="hero-robot-line" d="M162 360 l44 -5 M164 372 l44 -5" fill="none" />
      {/* envelope body */}
      <path
        className="hero-robot-line"
        d="M138 374
           L216 366
           L224 424
           L146 432 Z"
        fill="#ffffff"
      />
      {/* envelope open flap (V) */}
      <path
        className="hero-robot-line"
        d="M138 374 L182 406 L224 388"
        fill="none"
      />

      {/* ---- briefcase on the ground (right) ---- */}
      {/* handle */}
      <path
        className="hero-robot-line"
        d="M452 448
           C452 434 462 426 476 426
           C490 426 500 434 500 448"
        fill="none"
      />
      {/* body */}
      <path
        className="hero-robot-line"
        d="M416 448
           a10 10 0 0 1 10 -10
           L526 438
           a10 10 0 0 1 10 10
           L536 484
           a8 8 0 0 1 -8 8
           L424 492
           a8 8 0 0 1 -8 -8 Z"
        fill="#ffffff"
      />
      {/* case divider + latch */}
      <line className="hero-robot-line" x1="416" y1="462" x2="536" y2="462" />
      <rect
        className="hero-robot-line"
        x="466"
        y="454"
        width="20"
        height="14"
        rx="3"
        fill="#ffffff"
      />
    </g>
  );
}

export function HeroScene() {
  return (
    <>
      <svg
        className="hero-scene"
        viewBox="0 0 680 520"
        fill="none"
        aria-hidden="true"
      >
        {/* skyline */}
        <g className="hero-city">
          {buildings.map((b, i) => (
            <BuildingShape key={i} b={b} />
          ))}
          {/* ground line */}
          <line className="hero-city-line" x1="0" y1={GROUND} x2="680" y2={GROUND} />
        </g>

        <Robot />
      </svg>

      {/* animated clouds — each is a standalone SVG file */}
      <Image
        className="hero-cloud hero-cloud-1"
        src="/cloud-1.svg"
        alt=""
        aria-hidden="true"
        width={180}
        height={96}
      />
      <Image
        className="hero-cloud hero-cloud-2"
        src="/cloud-2.svg"
        alt=""
        aria-hidden="true"
        width={130}
        height={74}
      />
      <Image
        className="hero-cloud hero-cloud-3"
        src="/cloud-3.svg"
        alt=""
        aria-hidden="true"
        width={160}
        height={88}
      />
    </>
  );
}

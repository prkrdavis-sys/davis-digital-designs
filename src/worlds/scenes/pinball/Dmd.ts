import * as THREE from "three";

const W = 128;
const H = 32;

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragment = /* glsl */ `
  uniform sampler2D uText;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec2 grid = vec2(${W}.0, ${H}.0);
    vec2 cell = floor(vUv * grid);
    vec2 f = fract(vUv * grid) - 0.5;
    float lum = texture2D(uText, (cell + 0.5) / grid).r;
    float dot = smoothstep(0.46, 0.3, length(f));
    vec3 col = uColor * (0.035 + lum * uIntensity) * dot;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** An amber dot-matrix display drawing short messages from a 2D canvas. */
export class Dmd {
  readonly material: THREE.ShaderMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private last = "";

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uText: { value: this.texture }, uColor: { value: new THREE.Color("#ff8a24") }, uIntensity: { value: 3.2 } },
      toneMapped: false,
    });
  }

  /** Big line, optional small line, optional horizontal scroll in pixels. */
  draw(big: string, small = "", scroll = 0) {
    const key = `${big}|${small}|${Math.round(scroll)}`;
    if (key === this.last) return;
    this.last = key;
    const c = this.ctx;
    c.fillStyle = "#000";
    c.fillRect(0, 0, W, H);
    c.fillStyle = "#fff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = small ? "bold 15px 'Arial Black', Impact, sans-serif" : "bold 20px 'Arial Black', Impact, sans-serif";
    c.fillText(big, W / 2 - scroll, small ? 11 : 17);
    if (small) {
      c.font = "bold 9px Menlo, monospace";
      c.fillText(small, W / 2, 26);
    }
    this.texture.needsUpdate = true;
  }

  set intensity(v: number) {
    this.material.uniforms.uIntensity.value = v;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

/** What the display says at chapter time s. */
export function dmdMessage(s: number, t: number, parked: boolean): [string, string] {
  const blink = Math.floor(t * 2) % 2 === 0;
  if (parked) return ["NOW PLAYING", blink ? "DAVIS DIGITAL" : ""];
  if (s < 0.9) return Math.floor(t / 2.6) % 2 === 0 ? ["DAVIS DIGITAL", "GAMES · TOYS · MULTIBALL"] : ["PRESS START", blink ? "INSERT COIN" : ""];
  if (s < 2.0) return ["RAMP  x2", `${(Math.floor((s - 0.9) * 820000) + 125000).toLocaleString("en-US")}`];
  if (s < 3.0) return ["HABITRAIL!", blink ? "LOOP  LOOP  LOOP" : ""];
  if (s < 3.55) return ["LOCK IS LIT", `BALL ${Math.min(4, 1 + Math.floor((s - 3) * 8))} LOCKED`];
  return blink ? ["MULTIBALL", "JACKPOT 2,500,000"] : ["MULTIBALL!", ""];
}

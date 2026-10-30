// WebGL2 point renderer for scatter plots: millions of points as GPU point
// sprites, coloured by category or a continuous ramp, with marked points
// drawn on top and the rest dimmed while anything is marked.

import { PALETTE, ramp } from './axes.js';

const VS = `#version 300 es
in vec2 a_pos;
in float a_c;
in float a_m;
in float a_z;
in float a_s;
uniform vec2 u_scale;
uniform vec2 u_shift;
uniform vec2 u_off;
uniform vec2 u_log;
uniform float u_size;
uniform float u_alpha;
uniform float u_any;
uniform int u_pass;
uniform int u_cmode;
uniform float u_sizeBy;
uniform vec3 u_color;
uniform sampler2D u_pal;
uniform sampler2D u_ramp;
out vec4 v_color;
out float v_marked;
flat out int v_shape;
void main() {
  bool marked = a_m > 0.5;
  if ((u_pass == 1) != marked) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec2 p = a_pos;
  if (u_log.x > 0.5) p.x = log(p.x + u_off.x) / log(10.0);
  if (u_log.y > 0.5) p.y = log(p.y + u_off.y) / log(10.0);
  gl_Position = vec4(p * u_scale + u_shift, 0.0, 1.0);
  float size = u_sizeBy > 0.5 ? u_size * (0.45 + 2.4 * clamp(a_z, 0.0, 1.0)) : u_size;
  gl_PointSize = marked ? size + 1.5 : size;
  v_shape = int(a_s + 0.5);
  vec3 col;
  if (u_cmode == 2) col = u_color;
  else if (u_cmode == 1) col = a_c < 0.0 ? vec3(0.72) : texture(u_ramp, vec2(clamp(a_c, 0.0, 1.0), 0.5)).rgb;
  else col = texture(u_pal, vec2((mod(a_c, ${PALETTE.length}.0) + 0.5) / ${PALETTE.length}.0, 0.5)).rgb;
  float a = u_alpha;
  if (u_any > 0.5 && !marked) a *= 0.22;
  if (marked) a = 1.0;
  v_color = vec4(col, a);
  v_marked = marked ? 1.0 : 0.0;
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_marked;
flat in int v_shape;
out vec4 outColor;
// Marker shapes, in the order of MARKER_SHAPES.
bool inside(vec2 d, int s) {
  vec2 a = abs(d);
  if (s == 1) return max(a.x, a.y) <= 0.4;
  if (s == 2) return a.x + a.y <= 0.5;
  if (s == 3) return d.y <= 0.36 && a.x <= (d.y + 0.46) * 0.55;
  if (s == 4) return -d.y <= 0.36 && a.x <= (-d.y + 0.46) * 0.55;
  if (s == 5) return (a.x <= 0.12 || a.y <= 0.12) && max(a.x, a.y) <= 0.48;
  if (s == 6) return (abs(d.x - d.y) <= 0.17 || abs(d.x + d.y) <= 0.17) && max(a.x, a.y) <= 0.42;
  return length(d) <= 0.5;
}
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (!inside(d, v_shape)) discard;
  vec3 c = v_color.rgb;
  if (v_marked > 0.5 && (v_shape >= 5 || !inside(d / 0.66, v_shape))) c = vec3(0.08, 0.09, 0.11);
  float a = v_color.a * (v_shape == 0 ? 1.0 - smoothstep(0.42, 0.5, r) : 1.0);
  outColor = vec4(c * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function texture(gl, colors) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const data = new Uint8Array(colors.flatMap((c) => [...c, 255]));
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, colors.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export class PointLayer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.canvas = canvas;
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.bindAttribLocation(prog, 1, 'a_c');
    gl.bindAttribLocation(prog, 2, 'a_m');
    gl.bindAttribLocation(prog, 3, 'a_z');
    gl.bindAttribLocation(prog, 4, 'a_s');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = Object.fromEntries(['u_scale', 'u_shift', 'u_off', 'u_log', 'u_size', 'u_alpha', 'u_any', 'u_pass', 'u_cmode', 'u_sizeBy', 'u_color', 'u_pal', 'u_ramp'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.pal = texture(gl, PALETTE.map(hex));
    this.ramp = texture(gl, Array.from({ length: 64 }, (_, i) => ramp(i / 63)));
    this.series = [];
  }

  // series: [{ x, y, c, m (typed arrays), n, xOff, yOff, axis }]
  setData(series) {
    const gl = this.gl;
    for (const s of this.series) for (const b of s.buffers) gl.deleteBuffer(b);
    this.series = series.map((s) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const pos = new Float32Array(s.n * 2);
      for (let i = 0; i < s.n; i += 1) {
        pos[2 * i] = s.x[i];
        pos[2 * i + 1] = s.y[i];
      }
      const buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[1]);
      gl.bufferData(gl.ARRAY_BUFFER, s.c, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[2]);
      gl.bufferData(gl.ARRAY_BUFFER, s.m, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
      for (const [loc, arr] of [[3, s.z], [4, s.s]]) {
        if (!arr) {
          gl.disableVertexAttribArray(loc);
          continue;
        }
        const b = gl.createBuffer();
        buffers.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(null);
      let marked = 0;
      for (let i = 0; i < s.n; i += 1) marked += s.m[i];
      return { vao, buffers, n: s.n, xOff: s.xOff, yOff: s.yOff, axis: s.axis, marked, sized: !!s.z, shaped: !!s.s };
    });
  }

  // frame: { width, height (device px), rect: {x, y, w, h} plot area in device px,
  //          sx, sy: Scale per series axis, size, alpha, cmode }
  draw(frame) {
    const gl = this.gl;
    const { width, height, rect } = frame;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.series.length) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(rect.x), Math.floor(height - rect.y - rect.h), Math.ceil(rect.w), Math.ceil(rect.h));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pal);
    gl.uniform1i(this.u.u_pal, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.ramp);
    gl.uniform1i(this.u.u_ramp, 1);
    const any = this.series.some((s) => s.marked) ? 1 : 0;
    gl.uniform1f(this.u.u_any, any);
    gl.uniform1f(this.u.u_size, frame.size);
    gl.uniform1f(this.u.u_alpha, frame.alpha);
    gl.uniform1i(this.u.u_cmode, frame.cmode);
    const fixed = frame.color ? hex(frame.color).map((v) => v / 255) : [0, 0, 0];
    gl.uniform3f(this.u.u_color, fixed[0], fixed[1], fixed[2]);
    for (const pass of [0, 1]) {
      gl.uniform1i(this.u.u_pass, pass);
      for (const s of this.series) {
        if (pass === 1 && !s.marked) continue;
        const sx = frame.sx;
        const sy = frame.sy[s.axis] || frame.sy.left;
        // pixel = r0 + (t(v) - t0) * k, v = rel + off; clip = pixel * 2 / size - 1.
        const lin = (sc, off, size, flip) => {
          const k = sc.k * (2 / size);
          if (sc.log) return [k * (flip ? -1 : 1), ((sc.r0 - sc.t0 * sc.k) * 2) / size * (flip ? -1 : 1) + (flip ? 1 : -1)];
          return [k * (flip ? -1 : 1), (((off - sc.d0) * sc.k + sc.r0) * 2) / size * (flip ? -1 : 1) + (flip ? 1 : -1)];
        };
        const [ax, bx] = lin(sx, s.xOff, width, false);
        const [ay, by] = lin(sy, s.yOff, height, true);
        gl.uniform2f(this.u.u_scale, ax, ay);
        gl.uniform2f(this.u.u_shift, bx, by);
        gl.uniform2f(this.u.u_off, s.xOff, s.yOff);
        gl.uniform2f(this.u.u_log, sx.log ? 1 : 0, sy.log ? 1 : 0);
        gl.uniform1f(this.u.u_sizeBy, s.sized ? 1 : 0);
        if (!s.sized) gl.vertexAttrib1f(3, 0);
        if (!s.shaped) gl.vertexAttrib1f(4, frame.shape || 0);
        gl.bindVertexArray(s.vao);
        gl.drawArrays(gl.POINTS, 0, s.n);
      }
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const s of this.series) for (const b of s.buffers) gl.deleteBuffer(b);
    this.series = [];
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

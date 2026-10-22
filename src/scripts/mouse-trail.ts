/* Mouse trail -- A small fluid field rendered as fading ASCII characters.
 *
 * Pointer movement adds velocity and ink to a fixed-size grid. The GPU moves
 * both fields forward, then draws the ink as glyphs on the full-size canvas.
 * The simulation resolution is independent of the display resolution.
 *
 * The strings below are GLSL programs, compiled by WebGL at initialization.
 * TypeScript owns the resources and schedules the passes; GLSL computes each
 * output pixel. No animation frames are requested while the trail is idle. */
const SIZE = 180;
const LIFETIME = 2200;
const GLYPHS = '.:+*ox#';

/* ------------------------------- GPU shaders ----------------------------- */

/* All passes draw the same quad. Convert its clip-space coordinates [-1,1]
 * into texture coordinates [0,1], shared by the two fragment shaders. */
const vertex = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/* RGBA8 textures work in WebGL 1 without floating-point texture extensions.
 * Each field uses only the channels it needs:
 *
 *     flow        R,G = signed horizontal and vertical velocity
 *     ink         R   = density in [0,1]
 *     pressure    R   = signed pressure
 *     divergence  R   = signed local expansion of the velocity field
 *
 * Signed values in [-4,4] are mapped into [0,1], with zero at the midpoint.
 * Storage is quantized to eight bits, so this is an approximate visual fluid.
 * The texel size below must match SIZE. */
const simulation = `
precision highp float;
varying vec2 uv;
uniform sampler2D source;
uniform sampler2D field;
uniform int operation;
uniform float dt, decay, aspect, velocity;
uniform vec2 point, impulse;
const vec2 texel = vec2(1.0 / 180.0);
vec2 decode(vec2 value) { return (value - 0.5) * 8.0; }
vec2 encode(vec2 value) { return clamp(value / 8.0 + 0.5, 0.0, 1.0); }
float pressure(vec2 offset) { return decode(texture2D(source, uv + offset).rr).x; }
void main() {
  vec4 value = texture2D(source, uv);
  if (operation == 0) {
    /* Splat: add a soft spot of velocity or ink at the pointer. Correct the
     * horizontal distance for the viewport aspect ratio to keep it round. */
    vec2 distance = (uv - point) * vec2(aspect, 1.0);
    float ink = exp(-dot(distance, distance) / 0.00045);
    if (velocity > 0.5) value.xy = encode(decode(value.xy) + impulse * ink);
    else value.r = min(1.0, value.r + ink * 0.7);
  } else if (operation == 1) {
    /* Advection: trace backward through the velocity field and sample what
     * reaches this cell. Decay signed velocity after decoding, so it tends
     * toward rest rather than toward the lowest encoded value. */
    vec2 flow = decode(texture2D(field, uv).xy);
    value = texture2D(source, clamp(uv - flow * dt * 0.2, texel * 0.5, 1.0 - texel * 0.5));
    if (velocity > 0.5) value.xy = encode(decode(value.xy) * decay);
    else value.r *= decay;
  } else if (operation == 2) {
    /* Divergence: estimate how much velocity leaves each cell using its four
     * neighbors. The pressure solve uses this as its correction target. */
    float left = decode(texture2D(source, uv - vec2(texel.x, 0.0)).xy).x;
    float right = decode(texture2D(source, uv + vec2(texel.x, 0.0)).xy).x;
    float bottom = decode(texture2D(source, uv - vec2(0.0, texel.y)).xy).y;
    float top = decode(texture2D(source, uv + vec2(0.0, texel.y)).xy).y;
    value.r = encode(vec2((right - left + top - bottom) * 0.5)).x;
  } else if (operation == 3) {
    /* One Jacobi iteration of the pressure solve. Read the previous estimate
     * from source and the fixed divergence from field. Repeated passes spread
     * the correction across neighboring cells. */
    float sum = pressure(vec2(-texel.x, 0.0)) + pressure(vec2(texel.x, 0.0))
      + pressure(vec2(0.0, -texel.y)) + pressure(vec2(0.0, texel.y));
    float divergence = decode(texture2D(field, uv).rr).x;
    value.r = encode(vec2((sum - divergence) * 0.25)).x;
  } else {
    /* Projection (operation 4): subtract the pressure gradient from velocity
     * to reduce expansion and compression in the flow. */
    vec2 gradient = vec2(
      pressure(vec2(texel.x, 0.0)) - pressure(vec2(-texel.x, 0.0)),
      pressure(vec2(0.0, texel.y)) - pressure(vec2(0.0, -texel.y)));
    value.xy = encode(decode(texture2D(field, uv).xy) - gradient * 0.5);
  }
  gl_FragColor = vec4(value.rgb, 1.0);
}`;

/* Sample ink once per character cell, then use its density to select a glyph
 * from the atlas. Logarithmic mapping keeps faint ink visible; a small flicker
 * varies the glyph choice over time. The atlas must match GLYPHS: seven slots
 * ordered from sparse to dense. */
const display = `
precision highp float;
varying vec2 uv;
uniform sampler2D source, atlas;
uniform vec2 resolution;
uniform vec3 color;
uniform float cellSize, opacity, time;
void main() {
  vec2 pixel = uv * resolution;
  vec2 cell = floor(pixel / cellSize);
  vec2 center = (cell + 0.5) * cellSize / resolution;
  float density = texture2D(source, center).r;
  float flicker = fract(sin(dot(cell + floor(time * 8.0), vec2(12.9898, 78.233))) * 43758.5453);
  float life = clamp(1.0 + log(max(density, 0.001)) / 5.0 + (flicker - 0.5) * 0.12, 0.0, 0.999);
  float index = floor(life * 7.0);
  vec2 local = fract(pixel / cellSize);
  float glyph = texture2D(atlas, vec2((index + local.x) / 7.0, local.y)).a;
  float alpha = (glyph * smoothstep(0.015, 0.25, density) + density * 0.06) * opacity;
  /* The canvas uses premultiplied alpha, including the faint ink background. */
  gl_FragColor = vec4(color * alpha, alpha);
}`;

/* ------------------------- Resources and initialization ------------------ */

/* A pass cannot sample the texture it is rendering into. Mutable fields use
 * two targets, swapping their roles after each pass:
 *
 *     read.texture --> shader --> write.buffer
 *          ^                           |
 *          +---------- swap -----------+
 *
 * Divergence needs only one target: it is computed once per simulation step
 * and remains unchanged throughout the pressure iterations. */
type Target = { texture: WebGLTexture; buffer: WebGLFramebuffer };
type Pair = { read: Target; write: Target };

/* Initialize an idle trail and return its cleanup function. Return undefined
 * if graphics initialization fails. The caller decides whether motion and
 * visibility preferences allow the effect to run. */
export function createMouseTrail(canvas: HTMLCanvasElement): (() => void) | undefined {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, powerPreference: 'low-power',
  });
  if (!gl || gl.isContextLost()) return;

  /* Register cleanup as resources are acquired, so partial initialization
   * can use the same teardown path. Destroy is safe to call more than once. */
  const release: (() => void)[] = [];
  let frame = 0;
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    if (!gl.isContextLost()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    release.reverse().forEach(cleanup => cleanup());
  };

  try {
    /* Both programs share one vertex shader and attribute location. Shader
     * compilation and linking failures unwind through the cleanup stack. */
    const shader = (type: number, code: string) => {
      const result = gl.createShader(type);
      if (!result) throw new Error('Shader unavailable');
      release.push(() => gl.deleteShader(result));
      gl.shaderSource(result, code);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Shader unsupported');
      return result;
    };
    const vs = shader(gl.VERTEX_SHADER, vertex);
    const program = (code: string) => {
      const result = gl.createProgram();
      if (!result) throw new Error('Program unavailable');
      release.push(() => gl.deleteProgram(result));
      gl.attachShader(result, vs);
      gl.attachShader(result, shader(gl.FRAGMENT_SHADER, code));
      gl.bindAttribLocation(result, 0, 'position');
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error('Program unsupported');
      return result;
    };
    const sim = program(simulation);
    const render = program(display);
    const uniforms = (p: WebGLProgram, names: string[]) => Object.fromEntries(
      names.map(name => [name, gl.getUniformLocation(p, name)]),
    );
    const s = uniforms(sim, ['source', 'field', 'operation', 'dt', 'decay', 'aspect', 'velocity', 'point', 'impulse']);
    const d = uniforms(render, ['source', 'atlas', 'resolution', 'color', 'cellSize', 'opacity', 'time']);
    const quad = gl.createBuffer();
    if (!quad) throw new Error('Buffer unavailable');
    release.push(() => gl.deleteBuffer(quad));
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    /* Linear sampling interpolates the advected fields. Clamp-to-edge also
     * supplies boundary samples for neighbor lookups at the edge of the grid. */
    const texture = () => {
      const result = gl.createTexture();
      if (!result) throw new Error('Texture unavailable');
      release.push(() => gl.deleteTexture(result));
      gl.bindTexture(gl.TEXTURE_2D, result);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return result;
    };
    const target = (): Target => {
      const tex = texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const buffer = gl.createFramebuffer();
      if (!buffer) throw new Error('Framebuffer unavailable');
      release.push(() => gl.deleteFramebuffer(buffer));
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer unsupported');
      return { texture: tex, buffer };
    };
    const pair = (): Pair => ({ read: target(), write: target() });
    const flow = pair();
    const ink = pair();
    const pressure = pair();
    const divergence = target();
    const swap = (pair: Pair) => { [pair.read, pair.write] = [pair.write, pair.read]; };
    const clear = (target: Target, value: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
      gl.clearColor(value, value, value, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    /* Signed fields start at encoded zero; density starts empty. Divergence
     * is overwritten before it is read, so it does not need clearing. */
    const reset = () => {
      for (const t of [flow.read, flow.write, pressure.read, pressure.write]) clear(t, 0.5);
      for (const t of [ink.read, ink.write]) clear(t, 0);
    };
    reset();

    /* Build a horizontal atlas once, with one 32x32 slot per character. Only
     * its alpha is used by the display shader. Flip the upload to reconcile
     * canvas coordinates (top-down) with texture coordinates (bottom-up). */
    const glyphs = document.createElement('canvas');
    glyphs.width = GLYPHS.length * 32;
    glyphs.height = 32;
    const ctx = glyphs.getContext('2d');
    if (!ctx) throw new Error('Glyph canvas unavailable');
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [...GLYPHS].forEach((glyph, i) => ctx.fillText(glyph, i * 32 + 16, 16));
    const atlas = texture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyphs);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    /* ---------------------- Display state and drawing -------------------- */

    let width = 1;
    let height = 1;
    let ratio = 1;
    let lastInput = 0;
    let lastFrame = 0;
    let previous: { x: number; y: number } | undefined;
    let pending: { x: number; y: number; dx: number; dy: number } | undefined;
    let color = [0, 0, 0];
    /* The site's accent tokens are six-digit hex colors. Observe the theme
     * attribute so an existing trail picks up changes without rebuilding. */
    const theme = () => {
      const hex = getComputedStyle(canvas).getPropertyValue('--sl-color-accent').trim();
      color = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
    };
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    release.push(() => observer.disconnect());

    const bind = (texture: WebGLTexture, unit: number) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    };
    /* The caller selects the simulation program, viewport and scalar uniforms.
     * Output must be distinct from both sampled targets. */
    const pass = (operation: number, source: Target, field: Target, output: Target) => {
      gl.uniform1i(s.operation, operation);
      bind(source.texture, 0);
      bind(field.texture, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.buffer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    /* Stop drawing and discard old motion, but keep GPU resources available
     * for the next pointer movement. Destroy also releases those resources. */
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pending = undefined;
      previous = undefined;
      reset();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      /* Cap pixel density and backing width to reduce display-pass work.
       * The simulation grid keeps the same dimensions across resizes. */
      ratio = Math.min(devicePixelRatio || 1, 1.5, 1920 / Math.max(width, 1));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      stop();
    };
    resize();

    /* --------------------------- Simulation loop ------------------------- */

    /* One frame: inject input, advect velocity, solve pressure, project the
     * velocity, advect ink, then render. Time is measured in seconds inside
     * the simulation; cap the step to avoid large jumps after delayed frames. */
    const tick = (now: number) => {
      frame = 0;
      if (disposed) return;
      if (now - lastInput > LIFETIME) { stop(); return; }
      const dt = Math.min((now - lastFrame) / 1000, 0.033);
      lastFrame = now;
      gl.useProgram(sim);
      gl.viewport(0, 0, SIZE, SIZE);
      gl.uniform1i(s.source, 0);
      gl.uniform1i(s.field, 1);
      gl.uniform1f(s.aspect, width / height);
      gl.uniform1f(s.dt, dt);
      if (pending) {
        /* Spread input along the accumulated movement rather than leaving a
         * single dot at its end. Limit both splat count and impulse strength. */
        const { x, y, dx, dy } = pending;
        const steps = Math.min(10, Math.max(1, Math.ceil(Math.hypot(dx * width, dy * height) / 12)));
        for (let i = 1; i <= steps; i++) {
          gl.uniform2f(s.point, x - dx * (1 - i / steps), y - dy * (1 - i / steps));
          gl.uniform2f(s.impulse, Math.max(-2, Math.min(2, dx * 40)), Math.max(-2, Math.min(2, dy * 40)));
          gl.uniform1f(s.velocity, 1);
          pass(0, flow.read, flow.read, flow.write);
          swap(flow);
          gl.uniform1f(s.velocity, 0);
          pass(0, ink.read, ink.read, ink.write);
          swap(ink);
        }
        pending = undefined;
      }
      gl.uniform1f(s.velocity, 1);
      gl.uniform1f(s.decay, Math.exp(-7 * dt));
      pass(1, flow.read, flow.read, flow.write);
      swap(flow);
      pass(2, flow.read, flow.read, divergence);
      clear(pressure.read, 0.5);
      /* A fixed iteration count bounds the cost of the approximate solve.
       * Every pass writes the full target before the next swap. */
      for (let i = 0; i < 12; i++) {
        pass(3, pressure.read, divergence, pressure.write);
        swap(pressure);
      }
      pass(4, pressure.read, flow.read, flow.write);
      swap(flow);
      gl.uniform1f(s.velocity, 0);
      gl.uniform1f(s.decay, Math.exp(-4 * dt));
      pass(1, ink.read, flow.read, ink.write);
      swap(ink);

      /* Return to the canvas at display resolution. Cells stay eight CSS
       * pixels wide regardless of backing scale. Fade the whole trail during
       * its final half-second, then stop() clears it on expiry. */
      gl.useProgram(render);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      bind(ink.read.texture, 0);
      bind(atlas, 1);
      gl.uniform1i(d.source, 0);
      gl.uniform1i(d.atlas, 1);
      gl.uniform2f(d.resolution, canvas.width, canvas.height);
      gl.uniform3f(d.color, color[0], color[1], color[2]);
      gl.uniform1f(d.cellSize, 8 * ratio);
      gl.uniform1f(d.time, now / 1000);
      gl.uniform1f(d.opacity, 0.42 * Math.min(1, (LIFETIME - (now - lastInput)) / 500));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frame = requestAnimationFrame(tick);
    };
    /* -------------------------- Input and teardown ----------------------- */

    /* Convert viewport coordinates into bottom-up texture coordinates.
     * Several events may arrive before a frame: retain the latest position
     * and accumulate displacement. The first event only establishes an origin,
     * preventing a streak across the screen when the pointer enters. */
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !width || !height) return;
      const x = event.clientX / width;
      const y = 1 - event.clientY / height;
      if (previous) {
        const dx = x - previous.x;
        const dy = y - previous.y;
        if (dx || dy) {
          pending = { x, y, dx: dx + (pending?.dx ?? 0), dy: dy + (pending?.dy ?? 0) };
          lastInput = performance.now();
          if (!frame) { lastFrame = lastInput - 16; frame = requestAnimationFrame(tick); }
        }
      }
      previous = { x, y };
    };
    const leave = () => { previous = undefined; };
    const lost = (event: Event) => { event.preventDefault(); destroy(); };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('resize', resize, { passive: true });
    canvas.addEventListener('webglcontextlost', lost);
    release.push(() => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', lost);
    });
    return destroy;
  } catch {
    /* Graphics are optional: unsupported GPUs leave a normal static page. */
    destroy();
    return;
  }
}

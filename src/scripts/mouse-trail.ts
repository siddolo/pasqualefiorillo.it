/* Cursor trail rendered as fading ASCII characters over a 2D fluid simulation.
 *
 * Moving the pointer injects velocity and dye ("ink") into a fixed 180x180
 * grid. Each frame steps the fluid forward on that grid, then renders the ink
 * field at full canvas resolution by mapping local ink density to ASCII glyphs.
 *
 * WebGL splits the work between two languages:
 * - TypeScript (second half of the file) runs on the CPU: it allocates GPU
 *   textures and framebuffers, listens for input, and schedules draw passes.
 * - GLSL (the vertex, simulation, and display strings below) is the C-like
 *   shader language compiled by the WebGL driver at startup and executed on the
 *   GPU for every pixel of the target texture or canvas.
 *
 * The animation loop only runs while the trail is visible: it starts on pointer
 * movement and stops once the trail has faded out (LIFETIME ms after input). */
const SIZE = 180;
const LIFETIME = 2200;
const GLYPHS = '.:+*ox#';

/* ------------------------------- GPU shaders ----------------------------- */

/* Every GPU pass draws the same fullscreen rectangle (a 2-triangle strip with
 * clip-space coordinates in [-1, 1]). This vertex shader maps those coordinates
 * to UV texture coordinates in [0, 1] for the fragment shaders below. */
const vertex = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/* Fragment shader for all simulation steps.
 *
 * Standard WebGL 1 does not guarantee support for floating-point textures, so
 * all simulation grids are stored in plain 8-bit RGBA textures:
 *
 *     flow        R,G = horizontal and vertical velocity (signed)
 *     ink         R   = ink density in [0, 1]
 *     pressure    R   = pressure (signed)
 *     divergence  R   = local expansion/compression of flow (signed)
 *
 * Signed values in [-4, 4] are packed into [0, 1] via encode()/decode(), with
 * 0 mapped to 0.5. 8-bit precision is coarse, but plenty for a short-lived
 * visual effect.
 *
 * If you change SIZE, update texel (1.0 / SIZE) below as well. */
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
    /* Splat: add a Gaussian dab of velocity or ink around the cursor position.
     * Multiply X by the viewport aspect ratio so the brush stays circular. */
    vec2 distance = (uv - point) * vec2(aspect, 1.0);
    float ink = exp(-dot(distance, distance) / 0.00045);
    if (velocity > 0.5) value.xy = encode(decode(value.xy) + impulse * ink);
    else value.r = min(1.0, value.r + ink * 0.7);
  } else if (operation == 1) {
    /* Advection: move a field (velocity or ink) along the flow by looking up
     * where the fluid at uv came from a moment (dt) ago. Velocity must be
     * multiplied by decay in decoded space so it settles toward 0 (encoded
     * as 0.5) rather than -4 (encoded as 0.0). */
    vec2 flow = decode(texture2D(field, uv).xy);
    value = texture2D(source, clamp(uv - flow * dt * 0.2, texel * 0.5, 1.0 - texel * 0.5));
    if (velocity > 0.5) value.xy = encode(decode(value.xy) * decay);
    else value.r *= decay;
  } else if (operation == 2) {
    /* Divergence: measure net velocity flowing out of this cell by comparing
     * left/right and bottom/top neighbors. In an incompressible fluid this
     * should be zero; any non-zero value is removed by the pressure pass. */
    float left = decode(texture2D(source, uv - vec2(texel.x, 0.0)).xy).x;
    float right = decode(texture2D(source, uv + vec2(texel.x, 0.0)).xy).x;
    float bottom = decode(texture2D(source, uv - vec2(0.0, texel.y)).xy).y;
    float top = decode(texture2D(source, uv + vec2(0.0, texel.y)).xy).y;
    value.r = encode(vec2((right - left + top - bottom) * 0.5)).x;
  } else if (operation == 3) {
    /* Pressure solve (one Jacobi relaxation step): average the four neighboring
     * pressures from source and subtract the divergence from field. Running
     * this pass several times per frame finds the pressure field needed to keep
     * the fluid from bunching up. */
    float sum = pressure(vec2(-texel.x, 0.0)) + pressure(vec2(texel.x, 0.0))
      + pressure(vec2(0.0, -texel.y)) + pressure(vec2(0.0, texel.y));
    float divergence = decode(texture2D(field, uv).rr).x;
    value.r = encode(vec2((sum - divergence) * 0.25)).x;
  } else {
    /* Projection (operation 4): subtract the pressure gradient from the
     * velocity field so the flow swirls around obstacles instead of compressing. */
    vec2 gradient = vec2(
      pressure(vec2(texel.x, 0.0)) - pressure(vec2(-texel.x, 0.0)),
      pressure(vec2(0.0, texel.y)) - pressure(vec2(0.0, -texel.y)));
    value.xy = encode(decode(texture2D(field, uv).xy) - gradient * 0.5);
  }
  gl_FragColor = vec4(value.rgb, 1.0);
}`;

/* Fragment shader for the final display pass.
 *
 * Divides the canvas into cellSize-pixel character cells, samples the ink
 * density at the center of each cell, and picks one of the 7 characters in the
 * glyph atlas (if GLYPHS.length changes, update the 7.0 constants below).
 * A log curve stretches low densities so dying trails step through lighter
 * characters before disappearing, and a per-cell hash adds a slight 8 Hz
 * character shimmer. */
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
  /* The WebGL context is configured for premultiplied alpha. */
  gl_FragColor = vec4(color * alpha, alpha);
}`;

/* ------------------------- Resources and initialization ------------------ */

/* WebGL does not allow a draw call to sample from and render into the same
 * texture at the same time. Any grid updated from its own previous state
 * (flow, ink, pressure) therefore uses two targets and swaps them after
 * each pass:
 *
 *     read.texture --> shader --> write.buffer
 *          ^                           |
 *          +---------- swap -----------+
 *
 * divergence only needs a single target because it is written once from
 * flow and then only read during the pressure loop. */
type Target = { texture: WebGLTexture; buffer: WebGLFramebuffer };
type Pair = { read: Target; write: Target };

/* Attach the cursor trail to canvas and return an idempotent cleanup
 * function, or undefined if WebGL is unavailable. Motion and page-visibility
 * checks are left to the caller. */
export function createMouseTrail(canvas: HTMLCanvasElement): (() => void) | undefined {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, powerPreference: 'low-power',
  });
  if (!gl || gl.isContextLost()) return;

  /* Track every allocated GPU object and event listener in release so that
   * if initialization fails halfway through, destroy() can still free
   * everything created up to that point. */
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
    /* Compile the shared vertex shader and link the two fragment programs. */
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

    /* LINEAR filtering gives the advection pass free bilinear interpolation
     * between grid cells; CLAMP_TO_EDGE keeps neighbor lookups at the border
     * from wrapping around to the opposite side of the screen. */
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
    /* Signed grids (flow, pressure) represent 0 as 0.5; ink starts at 0. */
    const reset = () => {
      for (const t of [flow.read, flow.write, pressure.read, pressure.write]) clear(t, 0.5);
      for (const t of [ink.read, ink.write]) clear(t, 0);
    };
    reset();

    /* Render GLYPHS into a 2D offscreen canvas (one 32x32 cell per character)
     * and upload it as a texture strip. UNPACK_FLIP_Y_WEBGL flips the image on
     * upload because 2D canvas Y points down whereas WebGL texture Y points up. */
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
    /* Parse --sl-color-accent (#rrggbb) into normalized RGB and watch
     * data-theme on <html> so toggling dark/light mode recolors the active
     * trail without recreating the WebGL context. */
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
    const pass = (operation: number, source: Target, field: Target, output: Target) => {
      gl.uniform1i(s.operation, operation);
      bind(source.texture, 0);
      bind(field.texture, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.buffer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    /* Pause the loop and wipe the simulation grids + canvas, keeping all WebGL
     * resources allocated so the next cursor movement can resume immediately. */
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
      /* Cap pixel ratio at 1.5 and backing width at 1920px so the display pass
       * stays light on 4K/Retina screens. The fluid grid stays at SIZE x SIZE. */
      ratio = Math.min(devicePixelRatio || 1, 1.5, 1920 / Math.max(width, 1));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      stop();
    };
    resize();

    /* --------------------------- Simulation loop ------------------------- */

    /* Advance the fluid by one frame and draw the ASCII overlay. dt is
     * clamped to 33ms (~30 fps) so a slow frame or backgrounded tab doesn't
     * cause the advection step to overshoot. */
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
        /* Break fast cursor movements into up to 10 intermediate splats (~12px
         * apart) so quick swipes leave a continuous line instead of dots. */
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
      /* Advect velocity, compute divergence, relax pressure, project velocity,
       * and finally advect the ink along the divergence-free velocity field. */
      gl.uniform1f(s.velocity, 1);
      gl.uniform1f(s.decay, Math.exp(-7 * dt));
      pass(1, flow.read, flow.read, flow.write);
      swap(flow);
      pass(2, flow.read, flow.read, divergence);
      clear(pressure.read, 0.5);
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

      /* Draw the ink field onto the canvas as 8px CSS character cells, fading
       * the overall opacity out during the last 500ms of LIFETIME. */
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

    /* Convert viewport coordinates (top-left origin) to texture UV coordinates
     * (bottom-left origin) and accumulate displacements across events that
     * arrive between animation frames. The very first event after cursor entry
     * only records previous, avoiding a false stroke from an old position. */
    const move = (event: { clientX: number; clientY: number }) => {
      if (!width || !height) return;
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
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') move(event);
    };
    /* On mobile, browsers cancel pointermove as soon as a gesture becomes a
     * page scroll, whereas passive touchmove keeps firing during the scroll. */
    const touch = (event: TouchEvent) => {
      if (event.touches.length === 1) move(event.touches[0]);
      else leave();
    };
    const lost = (event: Event) => { event.preventDefault(); destroy(); };
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('touchstart', touch, { passive: true });
    window.addEventListener('touchmove', touch, { passive: true });
    window.addEventListener('touchend', leave, { passive: true });
    window.addEventListener('touchcancel', leave, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('resize', resize, { passive: true });
    canvas.addEventListener('webglcontextlost', lost);
    release.push(() => {
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('touchstart', touch);
      window.removeEventListener('touchmove', touch);
      window.removeEventListener('touchend', leave);
      window.removeEventListener('touchcancel', leave);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', lost);
    });
    return destroy;
  } catch {
    /* The trail is purely decorative; fail silently if WebGL is unsupported. */
    destroy();
    return;
  }
}

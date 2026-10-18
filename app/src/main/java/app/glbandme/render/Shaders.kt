package app.glbandme.render

/** GLSL ES 3.00 sources. */
object Shaders {

    const val MESH_VS = """#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aUV;
layout(location = 4) in float aMask;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
uniform mat4 uLightVP;
out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vColor;
out vec2 vUV;
out float vMask;
out vec4 vLightPos;
void main() {
    vec4 wp = uModel * vec4(aPos, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(uNormalMat * aNormal);
    vColor = aColor;
    vUV = aUV;
    vMask = aMask;
    vLightPos = uLightVP * wp;
    gl_Position = uViewProj * wp;
}
"""

    const val MESH_FS = """#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vColor;
in vec2 vUV;
in float vMask;
in vec4 vLightPos;
out vec4 fragColor;

uniform int uMode;            // 0 pbr, 1 matcap, 2 clay, 3 normals, 4 unlit
uniform vec4 uBaseColor;
uniform float uMetallic;
uniform float uRoughness;
uniform vec3 uEmissive;
uniform int uAlphaMode;       // 0 opaque, 1 mask, 2 blend
uniform float uAlphaCutoff;
uniform bool uUnlit;
uniform bool uFlat;
uniform bool uUseVertexColor;
uniform float uMaskShow;
uniform vec3 uCamPos;
uniform mat4 uView;

uniform bool uHasBaseTex;
uniform bool uHasMRTex;
uniform bool uHasNormalTex;
uniform bool uHasEmissiveTex;
uniform bool uHasOccTex;
uniform float uNormalScale;
uniform float uOccStrength;
uniform sampler2D uBaseTex;
uniform sampler2D uMRTex;
uniform sampler2D uNormalTex;
uniform sampler2D uEmissiveTex;
uniform sampler2D uOccTex;
uniform sampler2D uMatcap;

uniform vec3 uLightDir[3];
uniform vec3 uLightColor[3];
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uExposure;
uniform bool uShadows;
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
uniform vec4 uTint;           // rgb tint, a = amount (selection flash / highlight)

const float PI = 3.14159265;

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

vec3 aces(vec3 x) {
    const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 envColor(vec3 d, float rough) {
    float y = d.y;
    vec3 c = y > 0.0 ? mix(uHorizon, uSky, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, pow(clamp(-y, 0.0, 1.0), 0.35));
    // studio softboxes, blurred by roughness
    float sharp = mix(220.0, 3.0, rough);
    float energy = mix(1.6, 0.18, rough);
    for (int i = 0; i < 3; i++) {
        float s = max(dot(d, uLightDir[i]), 0.0);
        c += uLightColor[i] * pow(s, sharp) * energy;
    }
    return c;
}

vec3 envBRDFApprox(vec3 f0, float rough, float NoV) {
    const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = rough * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + ab.y;
}

float shadowFactor(vec3 n) {
    if (!uShadows) return 1.0;
    vec3 p = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float ndl = clamp(dot(n, uLightDir[0]), 0.05, 1.0);
    float bias = clamp(0.0018 * sqrt(1.0 - ndl * ndl) / ndl, 0.0008, 0.01);
    float s = 0.0;
    for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
            s += texture(uShadowMap, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel, p.z - bias));
    return s / 9.0;
}

vec3 perturbNormal(vec3 n, vec3 pos, vec2 uv) {
    vec3 dp1 = dFdx(pos); vec3 dp2 = dFdy(pos);
    vec2 duv1 = dFdx(uv); vec2 duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, n); vec3 dp1perp = cross(n, dp1);
    vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(dot(t, t), dot(b, b)) + 1e-12);
    mat3 tbn = mat3(t * invmax, b * invmax, n);
    vec3 m = texture(uNormalTex, uv).xyz * 2.0 - 1.0;
    m.xy *= uNormalScale;
    return normalize(tbn * m);
}

void main() {
    vec4 base = uBaseColor;
    if (uUseVertexColor) base *= vColor;
    if (uHasBaseTex) { vec4 t = texture(uBaseTex, vUV); base *= vec4(srgbToLinear(t.rgb), t.a); }
    if (uAlphaMode == 1 && base.a < uAlphaCutoff) discard;
    float alpha = uAlphaMode == 2 ? base.a : 1.0;

    vec3 n = uFlat ? normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))) : normalize(vNormal);
    if (!gl_FrontFacing && !uFlat) n = -n;
    if (uHasNormalTex && uMode == 0) n = perturbNormal(n, vWorldPos, vUV);
    vec3 v = normalize(uCamPos - vWorldPos);
    if (dot(n, v) < -0.2 && uFlat) n = -n;

    vec3 color;
    if (uMode == 3) {
        color = n * 0.5 + 0.5;
        fragColor = vec4(color, 1.0);
        return;
    } else if (uMode == 1) {
        vec3 vn = normalize((uView * vec4(n, 0.0)).xyz);
        vec2 muv = vn.xy * 0.49 + 0.5;
        vec3 mc = srgbToLinear(texture(uMatcap, vec2(muv.x, 1.0 - muv.y)).rgb);
        vec3 tint = uUseVertexColor ? vColor.rgb : vec3(1.0);
        if (uHasBaseTex) tint *= srgbToLinear(texture(uBaseTex, vUV).rgb);
        color = mc * tint * 1.15;
    } else if (uMode == 4 || uUnlit) {
        color = base.rgb;
    } else {
        float metallic = uMetallic;
        float rough = uRoughness;
        if (uHasMRTex) { vec4 mr = texture(uMRTex, vUV); rough *= mr.g; metallic *= mr.b; }
        if (uMode == 2) { metallic = 0.0; rough = 0.75; base.rgb = uUseVertexColor ? vColor.rgb * 0.8 : vec3(0.8); }
        rough = clamp(rough, 0.04, 1.0);
        vec3 albedo = base.rgb;
        vec3 f0 = mix(vec3(0.04), albedo, metallic);
        vec3 diffuseColor = albedo * (1.0 - metallic);
        float NoV = max(dot(n, v), 1e-4);
        float a = rough * rough;
        float a2 = a * a;
        vec3 direct = vec3(0.0);
        float sh = shadowFactor(n);
        for (int i = 0; i < 3; i++) {
            vec3 l = uLightDir[i];
            float NoL = max(dot(n, l), 0.0);
            if (NoL <= 0.0) continue;
            vec3 h = normalize(l + v);
            float NoH = max(dot(n, h), 0.0);
            float VoH = max(dot(v, h), 0.0);
            float dd = NoH * NoH * (a2 - 1.0) + 1.0;
            float D = a2 / (PI * dd * dd);
            float k = (rough + 1.0) * (rough + 1.0) / 8.0;
            float G = (NoV / (NoV * (1.0 - k) + k)) * (NoL / (NoL * (1.0 - k) + k));
            vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
            vec3 spec = D * G * F / max(4.0 * NoV * NoL, 1e-4);
            vec3 kd = (1.0 - F) * (1.0 - metallic);
            float s = i == 0 ? sh : 1.0;
            direct += (kd * diffuseColor / PI + spec) * uLightColor[i] * NoL * s;
        }
        vec3 irradiance = mix(uGround, uSky, n.y * 0.5 + 0.5) * 0.9 + uHorizon * 0.15;
        vec3 r = reflect(-v, n);
        vec3 specEnv = envColor(r, rough) * envBRDFApprox(f0, rough, NoV);
        float occ = 1.0;
        if (uHasOccTex) occ = mix(1.0, texture(uOccTex, vUV).r, uOccStrength);
        // cheap horizon occlusion so reflections don't leak below the surface
        float horizon = clamp(1.0 + dot(r, n), 0.0, 1.0);
        color = direct + (diffuseColor * irradiance + specEnv * horizon * horizon) * occ * mix(0.55, 1.0, sh);
    }
    vec3 emissive = uEmissive;
    if (uHasEmissiveTex) emissive *= srgbToLinear(texture(uEmissiveTex, vUV).rgb);
    color += emissive;
    color = mix(color, color * 0.32 + vec3(0.02, 0.02, 0.03), clamp(vMask, 0.0, 1.0) * uMaskShow);
    color = mix(color, uTint.rgb, uTint.a);
    if (uMode == 1 || uMode == 4 || uUnlit) color = clamp(color * uExposure, 0.0, 1.0);
    else color = aces(color * uExposure);
    fragColor = vec4(pow(color, vec3(1.0 / 2.2)), alpha);
}
"""

    const val DEPTH_VS = """#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }
"""

    const val DEPTH_FS = """#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
"""

    const val COLOR_VS = """#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
uniform float uInflate;
void main() {
    vec4 wp = uModel * vec4(aPos, 1.0);
    vec3 n = normalize(uNormalMat * aNormal);
    vec4 clip = uViewProj * wp;
    // grow in world space proportional to distance -> constant pixel width outline
    wp.xyz += n * uInflate * clip.w;
    gl_Position = uViewProj * wp;
}
"""

    const val COLOR_FS = """#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }
"""

    const val BG_VS = """#version 300 es
out vec2 vUv;
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.999, 1.0);
}
"""

    const val BG_FS = """#version 300 es
precision mediump float;
in vec2 vUv;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uTransparent;
out vec4 fragColor;
void main() {
    float t = smoothstep(0.0, 1.0, vUv.y);
    vec3 c = mix(uBottom, uTop, t);
    // subtle vignette
    vec2 d = vUv - 0.5;
    c *= 1.0 - dot(d, d) * 0.35;
    fragColor = vec4(c, 1.0 - uTransparent);
}
"""

    const val GRID_VS = """#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform float uExtent;
uniform vec2 uCenter;
uniform mat4 uLightVP;
out vec3 vWorld;
out vec4 vLightPos;
void main() {
    vec3 p = vec3(aPos.x * uExtent + uCenter.x, 0.0, aPos.z * uExtent + uCenter.y);
    vWorld = p;
    vLightPos = uLightVP * vec4(p, 1.0);
    gl_Position = uViewProj * vec4(p, 1.0);
}
"""

    const val GRID_FS = """#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in vec4 vLightPos;
uniform vec3 uCamPos;
uniform float uScale;
uniform float uFade;
uniform bool uShowGrid;
uniform bool uShadows;
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
uniform vec3 uLineColor;
out vec4 fragColor;

float gridLine(vec2 p, float scale) {
    vec2 g = p / scale;
    vec2 d = fwidth(g);
    vec2 l = abs(fract(g - 0.5) - 0.5) / d;
    return 1.0 - min(min(l.x, l.y), 1.0);
}

void main() {
    float dist = length(vWorld.xz - uCamPos.xz);
    float fade = 1.0 - smoothstep(uFade * 0.15, uFade * 0.6, dist);
    float a = 0.0;
    vec3 col = uLineColor;
    if (uShowGrid) {
        // fade minor lines out when they get denser than a few pixels
        vec2 dv = fwidth(vWorld.xz / uScale);
        float density = clamp(1.0 - max(dv.x, dv.y) * 2.5, 0.0, 1.0);
        float minor = gridLine(vWorld.xz, uScale) * 0.12 * density;
        float major = gridLine(vWorld.xz, uScale * 10.0) * 0.32;
        a = max(minor, major);
        // axis lines
        float ax = 1.0 - min(abs(vWorld.z) / fwidth(vWorld.z), 1.0);
        float az = 1.0 - min(abs(vWorld.x) / fwidth(vWorld.x), 1.0);
        if (ax > 0.01) { col = mix(col, vec3(0.9, 0.3, 0.32), ax); a = max(a, ax * 0.8); }
        if (az > 0.01) { col = mix(col, vec3(0.3, 0.55, 0.95), az); a = max(a, az * 0.8); }
    }
    float shadow = 0.0;
    if (uShadows) {
        vec3 p = vLightPos.xyz / vLightPos.w * 0.5 + 0.5;
        if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z < 1.0) {
            float s = 0.0;
            for (int x = -2; x <= 2; x++)
                for (int y = -2; y <= 2; y++)
                    s += texture(uShadowMap, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel * 1.5, p.z - 0.002));
            shadow = (1.0 - s / 25.0) * 0.55;
        }
    }
    vec3 c = mix(vec3(0.0), col, a / max(a + shadow, 1e-4));
    float alpha = max(a, shadow) * fade;
    if (alpha < 0.003) discard;
    fragColor = vec4(c, alpha);
}
"""
}

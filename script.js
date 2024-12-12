// WebGL着色器源码
const vsSource = `
    attribute vec2 aVertexPosition;
    attribute vec2 aTextureCoord;

    varying highp vec2 vTextureCoord;

    void main(void) {
        gl_Position = vec4(aVertexPosition, 0.0, 1.0);
        vTextureCoord = aTextureCoord;
    }
`

const fsSource = `
    precision highp float;

    varying highp vec2 vTextureCoord;

    uniform sampler2D uSampler;
    uniform vec2 uResolution;
    uniform float uScale;
    uniform vec3 uRotation;
    uniform vec2 uOffset;
    uniform float uRadius;

    const float PI = 3.14159265359;
    const float TWO_PI = 6.28318530718;

    mat3 computeRotationMatrix(vec3 rotation) {
        float cosA = cos(rotation.x);
        float sinA = sin(rotation.x);
        float cosB = cos(rotation.y);
        float sinB = sin(rotation.y);
        float cosG = cos(rotation.z);
        float sinG = sin(rotation.z);

        return mat3(
            cosG * cosB,
            cosG * sinB * sinA - sinG * cosA,
            cosG * sinB * cosA + sinG * sinA,
            sinG * cosB,
            sinG * sinB * sinA + cosG * cosA,
            sinG * sinB * cosA - cosG * sinA,
            -sinB,
            cosB * sinA,
            cosB * cosA
        );
    }

    vec3 projectToSphere(vec2 pixel) {
        vec2 adjusted = pixel + (uOffset - 0.5) * uResolution;
        float r = min(uResolution.x, uResolution.y) / 10.0 * uScale;
        vec3 point = vec3(adjusted, 0.0);
        float k = 2.0 * r * r / (dot(point.xy, point.xy) + r * r);
        return vec3(k * point.xy, (k - 1.0) * r);
    }

    vec2 getPixOnImg(vec3 point) {
        float r = uRadius;
        vec3 p = point;
        p.z = clamp(p.z, -r, r);

        float row = acos(p.z / r) / PI;
        float col = atan(p.y, p.x) / TWO_PI + 0.5;

        return vec2(col, row);
    }

    // 8x8超采样抗锯齿
    vec4 sampleTexture(vec2 coord) {
        const int SAMPLES = 8;
        const float STEP = 1.0 / float(SAMPLES);
        vec4 color = vec4(0.0);

        for(int i = 0; i < SAMPLES; i++) {
            for(int j = 0; j < SAMPLES; j++) {
                vec2 offset = vec2(float(i), float(j)) * STEP - 0.5;
                vec2 sampleCoord = coord + offset / uResolution;
                color += texture2D(uSampler, sampleCoord);
            }
        }

        return color / float(SAMPLES * SAMPLES);
    }

    void main(void) {
        vec2 pixCoord = vTextureCoord * uResolution;
        vec3 spherePoint = projectToSphere(pixCoord);
        mat3 rotMat = computeRotationMatrix(uRotation);
        vec3 rotatedPoint = rotMat * spherePoint;
        vec2 imgCoord = getPixOnImg(rotatedPoint);

        // 处理边界情况
        if (any(lessThan(imgCoord, vec2(0.0))) || any(greaterThan(imgCoord, vec2(1.0)))) {
            discard;
        }

        gl_FragColor = sampleTexture(imgCoord);
    }
`

class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl', {
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })

    if (!this.gl) {
      throw new Error('WebGL not supported')
    }

    // 设置视口以匹配画布尺寸
    this.resizeViewport()

    // 初始化着色器程序
    this.initShaderProgram()
    // 初始化缓冲区
    this.initBuffers()
    // 初始化纹理缓存
    this.textureCache = new Map()

    // 性能监控
    this.frameCount = 0
    this.lastTime = performance.now()
    this.fps = 0
  }

  resizeViewport() {
    // 获取画布的显示尺寸
    const displayWidth = this.canvas.clientWidth
    const displayHeight = this.canvas.clientHeight

    // 设置画布的绘制缓冲区尺寸匹配显示尺寸
    this.canvas.width = displayWidth
    this.canvas.height = displayHeight

    // 设置视口尺寸
    this.gl.viewport(0, 0, displayWidth, displayHeight)
  }

  initShaderProgram() {
    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vsSource)
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fsSource)

    const program = this.gl.createProgram()
    this.gl.attachShader(program, vertexShader)
    this.gl.attachShader(program, fragmentShader)
    this.gl.linkProgram(program)

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error('Shader program initialization failed')
    }

    this.program = program
    this.locations = {
      attributes: {
        position: this.gl.getAttribLocation(program, 'aVertexPosition'),
        texCoord: this.gl.getAttribLocation(program, 'aTextureCoord'),
      },
      uniforms: {
        sampler: this.gl.getUniformLocation(program, 'uSampler'),
        resolution: this.gl.getUniformLocation(program, 'uResolution'),
        scale: this.gl.getUniformLocation(program, 'uScale'),
        rotation: this.gl.getUniformLocation(program, 'uRotation'),
        offset: this.gl.getUniformLocation(program, 'uOffset'),
        radius: this.gl.getUniformLocation(program, 'uRadius'),
      },
    }
  }

  compileShader(type, source) {
    const shader = this.gl.createShader(type)
    this.gl.shaderSource(shader, source)
    this.gl.compileShader(shader)

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader)
      this.gl.deleteShader(shader)
      throw new Error(`Shader compilation failed: ${info}`)
    }

    return shader
  }

  initBuffers() {
    // 顶点位置缓冲区
    const positions = new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0])

    this.positionBuffer = this.gl.createBuffer()
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW)

    // 纹理坐标缓冲区
    const textureCoords = new Float32Array([0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0])

    this.texCoordBuffer = this.gl.createBuffer()
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, textureCoords, this.gl.STATIC_DRAW)
  }

  setupBuffers() {
    // 设置顶点位置属性
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer)
    this.gl.vertexAttribPointer(this.locations.attributes.position, 2, this.gl.FLOAT, false, 0, 0)
    this.gl.enableVertexAttribArray(this.locations.attributes.position)

    // 设置纹理坐标属性
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer)
    this.gl.vertexAttribPointer(this.locations.attributes.texCoord, 2, this.gl.FLOAT, false, 0, 0)
    this.gl.enableVertexAttribArray(this.locations.attributes.texCoord)
  }

  loadTexture(image) {
    const cacheKey = image.src
    let texture = this.textureCache.get(cacheKey)

    if (texture) {
      return texture
    }

    texture = this.gl.createTexture()
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)

    // 设置参数
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR)

    // 上传图像
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      image
    )

    this.textureCache.set(cacheKey, texture)
    return texture
  }

  render(params) {
    const { image, scale, alpha, beta, gamma, offsetHor, offsetVer } = params

    // 更新视口尺寸
    this.resizeViewport()

    // 清除画布
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)

    // 使用着色器程序
    this.gl.useProgram(this.program)

    // 设置缓冲区
    this.setupBuffers()

    // 设置uniforms
    this.gl.uniform2f(this.locations.uniforms.resolution, this.canvas.width, this.canvas.height)
    this.gl.uniform1f(this.locations.uniforms.scale, scale)
    this.gl.uniform3f(this.locations.uniforms.rotation, alpha, beta, gamma)
    this.gl.uniform2f(this.locations.uniforms.offset, offsetHor, offsetVer)
    this.gl.uniform1f(
      this.locations.uniforms.radius,
      (Math.min(this.canvas.height, this.canvas.width) / 10) * scale
    )

    // 设置纹理
    const texture = this.loadTexture(image)
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.uniform1i(this.locations.uniforms.sampler, 0)

    // 绘制
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)

    // 更新性能计数
    this.updatePerformanceMetrics()
  }

  updatePerformanceMetrics() {
    this.frameCount++
    const currentTime = performance.now()
    const elapsed = currentTime - this.lastTime

    if (elapsed >= 1000) {
      this.fps = (this.frameCount * 1000) / elapsed
      this.frameCount = 0
      this.lastTime = currentTime

      // 可以在这里添加FPS显示
      if (window.DEBUG) {
        console.log(`FPS: ${this.fps.toFixed(1)}`)
      }
    }
  }

  destroy() {
    // 清理纹理
    this.textureCache.forEach((texture) => {
      this.gl.deleteTexture(texture)
    })
    this.textureCache.clear()

    // 清理缓冲区
    this.gl.deleteBuffer(this.positionBuffer)
    this.gl.deleteBuffer(this.texCoordBuffer)

    // 清理着色器程序
    this.gl.deleteProgram(this.program)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('outputCanvas')
  const renderer = new WebGLRenderer(canvas)

  let img = new Image()
  let isProcessing = false
  let animationFrameId = null
  let pendingUpdate = false

  const outputWidth = 800
  const outputHeight = 600

  // 设置canvas尺寸
  canvas.width = outputWidth
  canvas.height = outputHeight

  function showLoading() {
    document.querySelector('.loading-indicator').style.display = 'flex'
    canvas.classList.remove('loaded')
  }

  function hideLoading() {
    document.querySelector('.loading-indicator').style.display = 'none'
    canvas.classList.add('loaded')
  }

  function loadDefaultImage() {
    showLoading()
    img.crossOrigin = 'anonymous'
    img.src = 'otto.webp'
    img.onerror = function () {
      console.error('Failed to load default image')
      hideLoading()
    }
    img.onload = function () {
      console.log('Default image loaded')
      requestUpdate()
      hideLoading()
    }
  }

  loadDefaultImage()

  // 文件上传处理
  const fileInput = document.getElementById('imageUpload')
  fileInput.addEventListener('change', function (e) {
    const file = e.target.files[0]
    if (file) {
      showLoading()
      const reader = new FileReader()
      reader.onload = function (event) {
        img = new Image()
        img.onload = function () {
          requestUpdate()
          hideLoading()
        }
        img.src = event.target.result
      }
      reader.readAsDataURL(file)
    }
  })

  // 下载功能
  document.getElementById('downloadBtn').addEventListener('click', function () {
    const link = document.createElement('a')
    link.download = 'projected_image.png'
    link.href = canvas.toDataURL('image/png', 1.0)
    link.click()
  })

  // 性能优化的更新请求函数
  function requestUpdate() {
    if (isProcessing) {
      pendingUpdate = true
      return
    }

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
    }

    animationFrameId = requestAnimationFrame(updateProjection)
  }

  const scaleInput = document.getElementById('scaleInput')
  const alphaInput = document.getElementById('alphaInput')
  const betaInput = document.getElementById('betaInput')
  const gammaInput = document.getElementById('gammaInput')
  const offsetHorInput = document.getElementById('offsetHorInput')
  const offsetVerInput = document.getElementById('offsetVerInput')
  function updateProjection() {
    if (!img.complete || isProcessing) {
      if (pendingUpdate) {
        animationFrameId = requestAnimationFrame(updateProjection)
      }
      return
    }

    isProcessing = true
    pendingUpdate = false

    const params = {
      image: img,
      scale: parseFloat(scaleInput.value),
      alpha: (parseFloat(alphaInput.value) * Math.PI) / 180,
      beta: (parseFloat(betaInput.value) * Math.PI) / 180,
      gamma: (parseFloat(gammaInput.value) * Math.PI) / 180,
      offsetHor: parseFloat(offsetHorInput.value),
      offsetVer: parseFloat(offsetVerInput.value),
    }

    try {
      renderer.render(params)
    } catch (error) {
      console.error('Render error:', error)
    }

    isProcessing = false

    if (pendingUpdate) {
      requestAnimationFrame(updateProjection)
    }
  }

  // 优化的滑块值更新
  function updateSliderValue(input) {
    const value = parseFloat(input.value)
    const label = input.parentElement.previousElementSibling
    const originalText = label.textContent.split('：')[0]
    label.textContent = `${originalText}：${value.toFixed(1)}`
  }

  // 使用 requestAnimationFrame 优化滑块监听
  let rafPending = false

  function handleSliderChange(input) {
    updateSliderValue(input)
    if (!rafPending) {
      rafPending = true
      requestAnimationFrame(() => {
        requestUpdate()
        rafPending = false
      })
    }
  }

  // 监听所有滑块的变化
  document.querySelectorAll('input[type="range"]').forEach((input) => {
    updateSliderValue(input)
    input.addEventListener('input', () => handleSliderChange(input))
  })

  // 优化调整按钮的点击处理
  document.querySelectorAll('.adjust-btn').forEach((btn) => {
    let intervalId = null
    let lastUpdateTime = 0
    const updateInterval = 1000 / 60 // 限制到60fps

    const startAdjust = () => {
      const currentTime = performance.now()
      if (currentTime - lastUpdateTime < updateInterval) {
        return
      }

      const input = document.getElementById(btn.dataset.input)
      const adjust = parseFloat(btn.dataset.adjust)
      let value = parseFloat(input.value) + adjust
      value = Math.max(parseFloat(input.min), Math.min(parseFloat(input.max), value))
      input.value = value

      handleSliderChange(input)
      lastUpdateTime = currentTime
    }

    btn.addEventListener('mousedown', () => {
      startAdjust()
      intervalId = setInterval(startAdjust, updateInterval)
    })

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault()
      startAdjust()
      intervalId = setInterval(startAdjust, updateInterval)
    })

    const stopAdjust = () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    btn.addEventListener('mouseup', stopAdjust)
    btn.addEventListener('mouseleave', stopAdjust)
    btn.addEventListener('touchend', stopAdjust)
    btn.addEventListener('touchcancel', stopAdjust)
  })

  // 导航切换功能
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')

      document.querySelectorAll('.controls-content').forEach((content) => {
        content.classList.remove('active')
      })

      const tabId = btn.dataset.tab
      document.querySelector(`[data-content="${tabId}"]`).classList.add('active')
    })
  })

  // 添加键盘控制支持
  document.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 1.0
    let input = null

    switch (e.key) {
      case 'ArrowLeft':
        input = document.getElementById('offsetHorInput')
        input.value = parseFloat(input.value) - step
        break
      case 'ArrowRight':
        input = document.getElementById('offsetHorInput')
        input.value = parseFloat(input.value) + step
        break
      case 'ArrowUp':
        input = document.getElementById('offsetVerInput')
        input.value = parseFloat(input.value) - step
        break
      case 'ArrowDown':
        input = document.getElementById('offsetVerInput')
        input.value = parseFloat(input.value) + step
        break
      case 'q':
        input = document.getElementById('alphaInput')
        input.value = parseFloat(input.value) - step
        break
      case 'w':
        input = document.getElementById('alphaInput')
        input.value = parseFloat(input.value) + step
        break
      case 'a':
        input = document.getElementById('betaInput')
        input.value = parseFloat(input.value) - step
        break
      case 's':
        input = document.getElementById('betaInput')
        input.value = parseFloat(input.value) + step
        break
      case 'z':
        input = document.getElementById('gammaInput')
        input.value = parseFloat(input.value) - step
        break
      case 'x':
        input = document.getElementById('gammaInput')
        input.value = parseFloat(input.value) + step
        break
      case '-':
        input = document.getElementById('scaleInput')
        input.value = parseFloat(input.value) - step * 0.1
        break
      case '=':
        input = document.getElementById('scaleInput')
        input.value = parseFloat(input.value) + step * 0.1
        break
    }

    if (input) {
      e.preventDefault()
      input.value = Math.max(
        parseFloat(input.min),
        Math.min(parseFloat(input.max), parseFloat(input.value))
      )
      handleSliderChange(input)
    }
  })

  // 添加触摸手势支持
  let touchStartX = 0
  let touchStartY = 0
  let lastTouchDistance = 0

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
    } else if (e.touches.length === 2) {
      lastTouchDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
    }
  })

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault()

    if (e.touches.length === 1) {
      // 反转 deltaX 和 deltaY 的计算
      const deltaX = ((touchStartX - e.touches[0].clientX) / canvas.width) * 2
      const deltaY = ((touchStartY - e.touches[0].clientY) / canvas.height) * 2

      const horInput = document.getElementById('offsetHorInput')
      const verInput = document.getElementById('offsetVerInput')

      horInput.value = parseFloat(horInput.value) + deltaX
      verInput.value = parseFloat(verInput.value) + deltaY

      handleSliderChange(horInput)
      handleSliderChange(verInput)

      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
    } else if (e.touches.length === 2) {
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )

      const scale = currentDistance / lastTouchDistance
      const scaleInput = document.getElementById('scaleInput')
      scaleInput.value = parseFloat(scaleInput.value) * scale
      handleSliderChange(scaleInput)

      lastTouchDistance = currentDistance
    }
  })
  // 窗口大小改变时重新计算canvas尺寸
  let resizeTimeout
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      requestUpdate()
    }, 250)
  })

  // 页面卸载时清理资源
  window.addEventListener('beforeunload', () => {
    renderer.destroy()
  })
})

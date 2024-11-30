$(document).ready(function() {
    const canvas = document.getElementById('outputCanvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    let img = new Image();
    let isProcessing = false;
    let cachedImageData = null;
    let lastRenderTime = 0;
    const frameInterval = 1000 / 30;

    const outputWidth = 800;
    const outputHeight = 600;

    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const workerPool = {
        workers: [],
        maxWorkers: 1,
        initialize() {
            for (let i = 0; i < this.maxWorkers; i++) {
                this.workers.push(new Worker('projection-worker.js'));
            }
        },
        getWorker() {
            return this.workers[0];
        },
        terminateAll() {
            this.workers.forEach(worker => worker.terminate());
            this.workers = [];
            this.initialize();
        }
    };

    workerPool.initialize();

    function showLoading() {
        $('.loading-indicator').show();
        canvas.classList.remove('loaded');
    }

    function hideLoading() {
        $('.loading-indicator').hide();
        canvas.classList.add('loaded');
    }

    function loadDefaultImage() {
        showLoading();
        img.crossOrigin = "anonymous";
        img.src = 'otto.png';
        img.onerror = function() {
            console.error('Failed to load default image');
            hideLoading();
        };
        img.onload = function() {
            console.log('Default image loaded');
            cachedImageData = getPixelData(img);
            updateProjection();
            hideLoading();
        };
    }

    loadDefaultImage();

    const fileInput = document.getElementById('imageUpload');
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            showLoading();
            const reader = new FileReader();
            reader.onload = function(event) {
                img = new Image();
                img.onload = function() {
                    cachedImageData = getPixelData(img);
                    updateProjection();
                    hideLoading();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('downloadBtn').addEventListener('click', function() {
        const link = document.createElement('a');
        link.download = 'projected_image.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    const updateProjection = throttle(function() {
        const currentTime = performance.now();
        if (currentTime - lastRenderTime < frameInterval) {
            requestAnimationFrame(updateProjection);
            return;
        }

        if (isProcessing || !cachedImageData) {
            return;
        }

        isProcessing = true;
        lastRenderTime = currentTime;

        const worker = workerPool.getWorker();
        const params = {
            scale: parseFloat($('#scaleInput').val()),
            alpha: parseFloat($('#alphaInput').val()) * Math.PI / 180,
            beta: parseFloat($('#betaInput').val()) * Math.PI / 180,
            gamma: parseFloat($('#gammaInput').val()) * Math.PI / 180,
            offset_hor: parseFloat($('#offsetHorInput').val()),
            offset_ver: parseFloat($('#offsetVerInput').val())
        };

        worker.postMessage({
            imageData: {
                data: cachedImageData,
                width: img.width,
                height: img.height
            },
            params: {
                w_proj: outputWidth,
                h_proj: outputHeight,
                ...params
            }
        });

        worker.onmessage = function(e) {
            if (e.data.type === 'done') {
                const imageData = new ImageData(e.data.result, outputWidth, outputHeight);
                ctx.putImageData(imageData, 0, 0);
                isProcessing = false;
            }
        };
    }, frameInterval);

    function getPixelData(img) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tempCtx = tempCanvas.getContext('2d', { alpha: false });
        tempCtx.drawImage(img, 0, 0);
        return tempCtx.getImageData(0, 0, img.width, img.height).data;
    }

    // 添加实时预览数值功能
    function updateSliderValue(input) {
        const value = parseFloat(input.value);
        const label = input.parentElement.previousElementSibling;
        const originalText = label.textContent.split('：')[0];
        label.textContent = `${originalText}：${value.toFixed(1)}`;
    }

    // 监听所有滑块的变化
    document.querySelectorAll('input[type="range"]').forEach(input => {
        updateSliderValue(input); // 初始化显示
        input.addEventListener('input', () => {
            updateSliderValue(input);
            updateProjection();
        });
    });

    // 优化调整按钮的点击处理
    document.querySelectorAll('.adjust-btn').forEach(btn => {
        let intervalId = null;
        const startAdjust = () => {
            const input = document.getElementById(btn.dataset.input);
            const adjust = parseFloat(btn.dataset.adjust);
            let value = parseFloat(input.value) + adjust;
            value = Math.max(input.min, Math.min(input.max, value));
            input.value = value;
            updateSliderValue(input);
            updateProjection();
        };

        btn.addEventListener('mousedown', () => {
            startAdjust();
            intervalId = setInterval(startAdjust, 150);
        });

        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startAdjust();
            intervalId = setInterval(startAdjust, 150);
        });

        const stopAdjust = () => {
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        btn.addEventListener('mouseup', stopAdjust);
        btn.addEventListener('mouseleave', stopAdjust);
        btn.addEventListener('touchend', stopAdjust);
        btn.addEventListener('touchcancel', stopAdjust);
    });

    // 导航切换功能
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 移除其他按钮的active类
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            // 添加当前按钮的active类
            btn.classList.add('active');
            
            // 隐藏所有内容
            document.querySelectorAll('.controls-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // 显示对应内容
            const tabId = btn.dataset.tab;
            document.querySelector(`[data-content="${tabId}"]`).classList.add('active');
        });
    });

    // 清理资源
    window.addEventListener('beforeunload', () => {
        workerPool.terminateAll();
    });
});
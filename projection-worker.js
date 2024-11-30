self.onmessage = function(e) {
    const { imageData, params } = e.data;
    const { w_proj, h_proj, scale, alpha, beta, gamma, offset_hor, offset_ver } = params;
    
    const r = Math.min(h_proj, w_proj) / 10 * scale;

    const rot_mat = [
        [
            Math.cos(gamma) * Math.cos(beta),
            Math.cos(gamma) * Math.sin(beta) * Math.sin(alpha) - Math.sin(gamma) * Math.cos(alpha),
            Math.cos(gamma) * Math.sin(beta) * Math.cos(alpha) + Math.sin(gamma) * Math.sin(alpha)
        ],
        [
            Math.sin(gamma) * Math.cos(beta),
            Math.sin(gamma) * Math.sin(beta) * Math.sin(alpha) + Math.cos(gamma) * Math.cos(alpha),
            Math.sin(gamma) * Math.sin(beta) * Math.cos(alpha) - Math.cos(gamma) * Math.sin(alpha)
        ],
        [
            -Math.sin(beta),
            Math.cos(beta) * Math.sin(alpha),
            Math.cos(beta) * Math.cos(alpha)
        ]
    ];

    const result = new Uint8ClampedArray(w_proj * h_proj * 4);
    const chunkSize = Math.floor(h_proj / 10);

    function processChunk(startY, endY) {
        for (let y = startY; y < endY; y++) {
            for (let x = 0; x < w_proj; x++) {
                const pix_proj = [y, x];
                const pix_img = projection(pix_proj, r, imageData.height, imageData.width, h_proj, w_proj, offset_hor, offset_ver, rot_mat);
                
                const index = (y * w_proj + x) * 4;
                const imgIndex = (pix_img[0] * imageData.width + pix_img[1]) * 4;
                
                result[index] = imageData.data[imgIndex];
                result[index + 1] = imageData.data[imgIndex + 1];
                result[index + 2] = imageData.data[imgIndex + 2];
                result[index + 3] = imageData.data[imgIndex + 3];
            }
        }
        self.postMessage({ type: 'progress', value: endY / h_proj });
    }

    for (let i = 0; i < 10; i++) {
        const startY = i * chunkSize;
        const endY = (i === 9) ? h_proj : (i + 1) * chunkSize;
        processChunk(startY, endY);
    }

    self.postMessage({ type: 'done', result });
};

function projection(pix_proj, r, h_img, w_img, h_proj, w_proj, offset_hor, offset_ver, rot_mat) {
    const [row, col] = pix_proj;
    const x = row + (offset_ver - 0.5) * h_proj;
    const y = col + (offset_hor - 0.5) * w_proj;
    const z = 0;
    const Q = [x, y, z];
    let P = getPointOnSphere(Q, r);
    P = axisRotate(P, rot_mat);
    return getPixOnImg(P, r, h_img, w_img);
}

function getPointOnSphere(point, r) {
    const [x, y, z] = point;
    const k = 2 * r**2 / (x**2 + y**2 + r**2);
    return [k * x, k * y, (k - 1) * r];
}

function axisRotate(point, rot_mat) {
    return [
        rot_mat[0][0] * point[0] + rot_mat[0][1] * point[1] + rot_mat[0][2] * point[2],
        rot_mat[1][0] * point[0] + rot_mat[1][1] * point[1] + rot_mat[1][2] * point[2],
        rot_mat[2][0] * point[0] + rot_mat[2][1] * point[1] + rot_mat[2][2] * point[2]
    ];
}

function getPixOnImg(point, r, h_img, w_img) {
    let [x, y, z] = point;
    if (z > r) z = r;
    const row = Math.acos(z / r) / Math.PI;
    const col = Math.atan2(y, x) / (2 * Math.PI) + 0.5;
    return [
        Math.round(row * h_img) % h_img,
        Math.round(col * w_img) % w_img
    ];
}


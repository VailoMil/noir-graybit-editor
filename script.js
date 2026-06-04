// ===== GrayBit-7 Codec =====
class GrayBit7Codec {
    static SIGNATURE = new Uint8Array([0x47, 0x42, 0x37, 0x1D]);
    static VERSION = 0x01;

    static decode(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const view = new DataView(arrayBuffer);
        for (let i = 0; i < 4; i++) {
            if (bytes[i] !== this.SIGNATURE[i]) throw new Error('Неверная подпись GB7');
        }
        const version = bytes[4];
        if (version !== this.VERSION) throw new Error(`Неподдерживаемая версия GB7: ${version}`);
        const flags = bytes[5];
        const hasMask = (flags & 0x01) !== 0;
        const width = view.getUint16(6, false);
        const height = view.getUint16(8, false);
        const pixelData = new Uint8Array(bytes.buffer, 12, width * height);
        const imageData = new ImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const pixel = pixelData[i];
            const gray = pixel & 0x7F;
            const maskBit = (pixel >> 7) & 0x01;
            const gray8 = Math.round(gray * (255 / 127));
            const idx = i * 4;
            imageData.data[idx] = gray8;
            imageData.data[idx + 1] = gray8;
            imageData.data[idx + 2] = gray8;
            imageData.data[idx + 3] = hasMask ? (maskBit === 1 ? 255 : 0) : 255;
        }
        return { imageData, hasMask, width, height };
    }
    
    static encode(imageData, hasMask = false) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        const buffer = new ArrayBuffer(12 + width * height);
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        bytes.set(this.SIGNATURE, 0);
        bytes[4] = this.VERSION;
        bytes[5] = hasMask ? 0x01 : 0x00;
        view.setUint16(6, width, false);
        view.setUint16(8, height, false);
        view.setUint16(10, 0, false);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const alpha = data[idx + 3];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            const gray7 = Math.round(gray * (127 / 255));
            let maskBit = 0;
            if (hasMask) maskBit = alpha >= 128 ? 1 : 0;
            const pixelByte = (maskBit << 7) | (gray7 & 0x7F);
            bytes[12 + i] = pixelByte;
        }
        return buffer;
    }
}

// ===== Конвертер RGB в CIELAB =====
class ColorConverter {
    static rgbToXyz(r, g, b) {
        let rr = r / 255, gg = g / 255, bb = b / 255;
        rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
        gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
        bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
        rr *= 100; gg *= 100; bb *= 100;
        const x = rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375;
        const y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750;
        const z = rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041;
        return { x, y, z };
    }
    
    static xyzToLab(x, y, z) {
        const xn = 95.047, yn = 100.000, zn = 108.883;
        let fx = x / xn, fy = y / yn, fz = z / zn;
        fx = fx > 0.008856 ? Math.pow(fx, 1/3) : (7.787 * fx) + (16 / 116);
        fy = fy > 0.008856 ? Math.pow(fy, 1/3) : (7.787 * fy) + (16 / 116);
        fz = fz > 0.008856 ? Math.pow(fz, 1/3) : (7.787 * fz) + (16 / 116);
        const L = (116 * fy) - 16;
        const a = 500 * (fx - fy);
        const b = 200 * (fy - fz);
        return { L: Math.round(L), a: Math.round(a), b: Math.round(b) };
    }
    
    static rgbToLab(r, g, b) {
        const { x, y, z } = this.rgbToXyz(r, g, b);
        return this.xyzToLab(x, y, z);
    }
}

// ===== ИНТЕРПОЛЯЦИЯ =====
class ImageScaler {
    static nearestNeighbor(srcData, srcW, srcH, dstW, dstH) {
        const dstData = new Uint8ClampedArray(dstW * dstH * 4);
        const xRatio = srcW / dstW;
        const yRatio = srcH / dstH;
        for (let y = 0; y < dstH; y++) {
            const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
            for (let x = 0; x < dstW; x++) {
                const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
                const srcIdx = (srcY * srcW + srcX) * 4;
                const dstIdx = (y * dstW + x) * 4;
                dstData[dstIdx] = srcData[srcIdx];
                dstData[dstIdx + 1] = srcData[srcIdx + 1];
                dstData[dstIdx + 2] = srcData[srcIdx + 2];
                dstData[dstIdx + 3] = srcData[srcIdx + 3];
            }
        }
        return dstData;
    }
    
    static bilinear(srcData, srcW, srcH, dstW, dstH) {
        const dstData = new Uint8ClampedArray(dstW * dstH * 4);
        const xRatio = srcW / dstW;
        const yRatio = srcH / dstH;
        for (let y = 0; y < dstH; y++) {
            const srcY = y * yRatio;
            const y1 = Math.floor(srcY);
            const y2 = Math.min(y1 + 1, srcH - 1);
            const dy = srcY - y1;
            for (let x = 0; x < dstW; x++) {
                const srcX = x * xRatio;
                const x1 = Math.floor(srcX);
                const x2 = Math.min(x1 + 1, srcW - 1);
                const dx = srcX - x1;
                const idx11 = (y1 * srcW + x1) * 4;
                const idx21 = (y1 * srcW + x2) * 4;
                const idx12 = (y2 * srcW + x1) * 4;
                const idx22 = (y2 * srcW + x2) * 4;
                for (let c = 0; c < 4; c++) {
                    const v11 = srcData[idx11 + c];
                    const v21 = srcData[idx21 + c];
                    const v12 = srcData[idx12 + c];
                    const v22 = srcData[idx22 + c];
                    const v1 = v11 * (1 - dx) + v21 * dx;
                    const v2 = v12 * (1 - dx) + v22 * dx;
                    const val = v1 * (1 - dy) + v2 * dy;
                    const dstIdx = (y * dstW + x) * 4 + c;
                    dstData[dstIdx] = Math.min(255, Math.max(0, Math.round(val)));
                }
            }
        }
        return dstData;
    }
    
    static scale(imageData, newWidth, newHeight, method = 'bilinear') {
        const srcData = imageData.data;
        const srcW = imageData.width;
        const srcH = imageData.height;
        let dstData;
        if (method === 'nearest') {
            dstData = this.nearestNeighbor(srcData, srcW, srcH, newWidth, newHeight);
        } else {
            dstData = this.bilinear(srcData, srcW, srcH, newWidth, newHeight);
        }
        const newImageData = new ImageData(newWidth, newHeight);
        newImageData.data.set(dstData);
        return newImageData;
    }
}

// ===== ДЕТЕКТИВНОЕ ДЕЛО =====
class DetectiveCase {
    constructor() {
        this.originalImageData = null;
        this.currentImageData = null;
        this.currentFormat = null;
        this.hasMask = false;
        this.caseNumber = Math.floor(Math.random() * 900) + 100;
        this.channels = { red: true, green: true, blue: true, alpha: true };
        this.eyedropperActive = false;
        this.currentScale = 100;
        this.init();
    }
    
    showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
    
    init() {
        this.caseCover = document.getElementById('caseCover');
        this.openCaseBtn = document.getElementById('openCaseBtn');
        this.pageDossier = document.getElementById('pageDossier');
        this.pageLab = document.getElementById('pageLab');
        this.coverCaseNumber = document.getElementById('coverCaseNumber');
        this.fileInput = document.getElementById('fileInput');
        this.uploadArea = document.getElementById('uploadArea');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.toLabBtn = document.getElementById('toLabBtn');
        this.backToDossierBtn = document.getElementById('backToDossierBtn');
        this.closeFromDossierBtn = document.getElementById('closeFromDossierBtn');
        this.closeFromLabBtn = document.getElementById('closeFromLabBtn');
        this.fileInfo = document.getElementById('fileInfo');
        this.fileNameSpan = document.getElementById('fileName');
        this.fileFormatSpan = document.getElementById('fileFormat');
        this.fileSizeSpan = document.getElementById('fileSize');
        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.savePngBtn = document.getElementById('savePngBtn');
        this.saveJpgBtn = document.getElementById('saveJpgBtn');
        this.saveGb7Btn = document.getElementById('saveGb7Btn');
        this.labWidth = document.getElementById('labWidth');
        this.labHeight = document.getElementById('labHeight');
        this.labAlpha = document.getElementById('labAlpha');
        this.eyedropperBtn = document.getElementById('eyedropperBtn');
        this.colorInfo = document.getElementById('colorInfo');
        this.labScale = document.getElementById('labScale');
        this.resetImageBtn = document.getElementById('resetImageBtn');
        
        this.coverCaseNumber.textContent = this.caseNumber;
        
        this.openCaseBtn.onclick = () => this.openCase();
        this.uploadArea.onclick = () => this.fileInput.click();
        this.uploadBtn.onclick = () => this.fileInput.click();
        this.fileInput.onchange = (e) => this.loadFile(e);
        this.toLabBtn.onclick = () => this.goToLab();
        this.backToDossierBtn.onclick = () => this.goToDossier();
        this.closeFromDossierBtn.onclick = () => this.closeCase();
        this.closeFromLabBtn.onclick = () => this.closeCase();
        
        if (this.resetImageBtn) {
            this.resetImageBtn.onclick = () => this.resetToOriginal();
        }
        
        this.uploadArea.ondragover = (e) => e.preventDefault();
        this.uploadArea.ondrop = (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) this.processFile(file);
        };
        
        this.savePngBtn.onclick = () => this.saveAsPNG();
        this.saveJpgBtn.onclick = () => this.saveAsJPG();
        this.saveGb7Btn.onclick = () => this.saveAsGB7();
        
        this.eyedropperBtn.onclick = () => this.toggleEyedropper();
        this.canvas.onclick = (e) => this.handleCanvasClick(e);
        
        window.onresize = () => this.fitCanvas();
    }
    
    resetToOriginal() {
        if (!this.originalImageData) {
            this.showToast('Нет оригинального изображения для сброса', 'error');
            return;
        }
        this.currentImageData = this.cloneImageData(this.originalImageData);
        this.channels = { red: true, green: true, blue: true, alpha: true };
        this.currentScale = 100;
        const scaleRange = document.getElementById('scaleRange');
        const scalePercentSpan = document.getElementById('scalePercent');
        if (scaleRange) scaleRange.value = 100;
        if (scalePercentSpan) scalePercentSpan.textContent = '100%';
        if (this.labScale) this.labScale.textContent = '100%';
        this.renderCanvas();
        this.generateChannelPreviews();
        this.updateLabInfo();
        this.showToast('✓ Изображение сброшено до оригинального', 'success');
    }
    
    toggleEyedropper() {
        this.eyedropperActive = !this.eyedropperActive;
        if (this.eyedropperActive) {
            this.eyedropperBtn.classList.add('active');
            document.querySelector('.canvas-container').classList.add('eyedropper-active');
            this.showToast('🔍 Отпечаток активирован. Кликните на изображение', 'info');
        } else {
            this.eyedropperBtn.classList.remove('active');
            document.querySelector('.canvas-container').classList.remove('eyedropper-active');
        }
    }
    
    handleCanvasClick(e) {
        if (!this.eyedropperActive || !this.currentImageData) return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;
        const x = Math.floor(Math.max(0, Math.min(mouseX, this.currentImageData.width - 1)));
        const y = Math.floor(Math.max(0, Math.min(mouseY, this.currentImageData.height - 1)));
        const idx = (y * this.currentImageData.width + x) * 4;
        const r = this.currentImageData.data[idx];
        const g = this.currentImageData.data[idx + 1];
        const b = this.currentImageData.data[idx + 2];
        const lab = ColorConverter.rgbToLab(r, g, b);
        document.getElementById('coordX').textContent = x;
        document.getElementById('coordY').textContent = y;
        document.getElementById('colorR').textContent = r;
        document.getElementById('colorG').textContent = g;
        document.getElementById('colorB').textContent = b;
        document.getElementById('colorL').textContent = lab.L;
        document.getElementById('colorA').textContent = lab.a;
        document.getElementById('colorB2').textContent = lab.b;
        document.getElementById('colorPreview').style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        this.colorInfo.style.display = 'flex';
        this.showToast(`📍 (${x},${y}) RGB(${r},${g},${b}) Lab(${lab.L},${lab.a},${lab.b})`, 'success');
    }
    
    openCase() {
        this.caseCover.style.display = 'none';
        this.pageDossier.style.display = 'block';
        this.resetCaseData();
    }
    
    closeCase() {
        this.originalImageData = null;
        this.currentImageData = null;
        this.currentFormat = null;
        this.hasMask = false;
        this.fileInfo.style.display = 'none';
        this.toLabBtn.disabled = true;
        this.fileInput.value = '';
        this.pageDossier.style.display = 'none';
        this.pageLab.style.display = 'none';
        this.caseCover.style.display = 'block';
        this.caseNumber = Math.floor(Math.random() * 900) + 100;
        this.coverCaseNumber.textContent = this.caseNumber;
        this.canvas.width = 800;
        this.canvas.height = 600;
        this.ctx.fillStyle = '#1B1A1D';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.showToast('✦ ДЕЛО ЗАКРЫТО ✦', 'success');
        this.eyedropperActive = false;
        this.eyedropperBtn.classList.remove('active');
        document.querySelector('.canvas-container')?.classList.remove('eyedropper-active');
        this.colorInfo.style.display = 'none';
        this.channels = { red: true, green: true, blue: true, alpha: true };
        this.currentScale = 100;
    }
    
    resetCaseData() {
        this.originalImageData = null;
        this.currentImageData = null;
        this.currentFormat = null;
        this.hasMask = false;
        this.fileInfo.style.display = 'none';
        this.toLabBtn.disabled = true;
        this.fileInput.value = '';
        this.channels = { red: true, green: true, blue: true, alpha: true };
        this.currentScale = 100;
    }
    
    async loadFile(event) {
        const file = event.target.files[0];
        if (file) await this.processFile(file);
    }
    
    async processFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const sizeKB = (file.size / 1024).toFixed(1);
        this.fileNameSpan.textContent = file.name;
        this.fileFormatSpan.textContent = ext.toUpperCase();
        this.fileSizeSpan.textContent = `${sizeKB} KB`;
        this.fileInfo.style.display = 'block';
        try {
            if (ext === 'gb7') {
                const buffer = await file.arrayBuffer();
                const { imageData, hasMask } = GrayBit7Codec.decode(buffer);
                this.originalImageData = imageData;
                this.currentImageData = this.cloneImageData(imageData);
                this.hasMask = hasMask;
                this.currentFormat = 'gb7';
                this.toLabBtn.disabled = false;
                this.showToast(`✓ Улика загружена`, 'success');
            } else {
                const img = new Image();
                img.onload = () => {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(img, 0, 0);
                    this.originalImageData = tempCtx.getImageData(0, 0, img.width, img.height);
                    this.currentImageData = this.cloneImageData(this.originalImageData);
                    this.hasMask = false;
                    this.currentFormat = ext;
                    this.toLabBtn.disabled = false;
                    this.showToast(`✓ Улика загружена`, 'success');
                    URL.revokeObjectURL(img.src);
                };
                img.onerror = () => this.showToast('Ошибка загрузки', 'error');
                img.src = URL.createObjectURL(file);
            }
        } catch (err) {
            this.showToast(`Ошибка: ${err.message}`, 'error');
        }
    }
    
    cloneImageData(imageData) {
        const cloned = new ImageData(imageData.width, imageData.height);
        cloned.data.set(imageData.data);
        return cloned;
    }
    
    applyChannels() {
        if (!this.originalImageData) return;
        const width = this.originalImageData.width;
        const height = this.originalImageData.height;
        const newImageData = new ImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            let r = this.originalImageData.data[idx];
            let g = this.originalImageData.data[idx + 1];
            let b = this.originalImageData.data[idx + 2];
            const a = this.originalImageData.data[idx + 3];
            if (!this.channels.red) r = 0;
            if (!this.channels.green) g = 0;
            if (!this.channels.blue) b = 0;
            newImageData.data[idx] = r;
            newImageData.data[idx + 1] = g;
            newImageData.data[idx + 2] = b;
            newImageData.data[idx + 3] = this.channels.alpha ? a : 255;
        }
        this.currentImageData = newImageData;
        this.renderCanvas();
        this.updateChannelPreviews();
    }
    
    updateChannelPreviews() {
        if (!this.originalImageData) return;
        const cards = document.querySelectorAll('.channel-card');
        const getters = [(r,g,b,a)=>r, (r,g,b,a)=>g, (r,g,b,a)=>b, (r,g,b,a)=>a];
        for (let i = 0; i < cards.length && i < 4; i++) {
            this.updateSinglePreview(cards[i], getters[i]);
        }
    }
    
    updateSinglePreview(card, getValue) {
        if (!this.originalImageData) return;
        const w = this.originalImageData.width;
        const h = this.originalImageData.height;
        let min=255, max=0;
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            const val = getValue(this.originalImageData.data[idx], this.originalImageData.data[idx+1], this.originalImageData.data[idx+2], this.originalImageData.data[idx+3]);
            min = Math.min(min, val);
            max = Math.max(max, val);
        }
        const canvas = document.createElement('canvas');
        canvas.width = 70;
        canvas.height = 70;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(70, 70);
        for (let y = 0; y < 70; y++) {
            for (let x = 0; x < 70; x++) {
                const sx = Math.floor(x / 70 * w);
                const sy = Math.floor(y / 70 * h);
                const idx = (sy * w + sx) * 4;
                let val = getValue(this.originalImageData.data[idx], this.originalImageData.data[idx+1], this.originalImageData.data[idx+2], this.originalImageData.data[idx+3]);
                if (max > min) val = (val - min) / (max - min) * 255;
                else val = 128;
                const didx = (y * 70 + x) * 4;
                imgData.data[didx] = val;
                imgData.data[didx+1] = val;
                imgData.data[didx+2] = val;
                imgData.data[didx+3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const img = card.querySelector('.channel-preview');
        if (img) img.src = canvas.toDataURL();
    }
    
    generateChannelPreviews() {
        if (!this.originalImageData) return;
        const w = this.originalImageData.width, h = this.originalImageData.height;
        let minR=255,maxR=0, minG=255,maxG=0, minB=255,maxB=0, minA=255,maxA=0;
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            const r = this.originalImageData.data[idx];
            const g = this.originalImageData.data[idx+1];
            const b = this.originalImageData.data[idx+2];
            const a = this.originalImageData.data[idx+3];
            minR=Math.min(minR,r); maxR=Math.max(maxR,r);
            minG=Math.min(minG,g); maxG=Math.max(maxG,g);
            minB=Math.min(minB,b); maxB=Math.max(maxB,b);
            minA=Math.min(minA,a); maxA=Math.max(maxA,a);
        }
        const channels = [
            { name: 'RED', key: 'red', get: (r)=>r, min: minR, max: maxR },
            { name: 'GREEN', key: 'green', get: (r,g)=>g, min: minG, max: maxG },
            { name: 'BLUE', key: 'blue', get: (r,g,b)=>b, min: minB, max: maxB },
            { name: 'ALPHA', key: 'alpha', get: (r,g,b,a)=>a, min: minA, max: maxA }
        ];
        const grid = document.getElementById('channelsGrid');
        if (!grid) return;
        grid.innerHTML = '';
        channels.forEach(ch => {
            const previewCanvas = document.createElement('canvas');
            previewCanvas.width = 70;
            previewCanvas.height = 70;
            const pctx = previewCanvas.getContext('2d');
            const pdata = pctx.createImageData(70, 70);
            for (let y = 0; y < 70; y++) {
                for (let x = 0; x < 70; x++) {
                    const sx = Math.floor(x / 70 * w);
                    const sy = Math.floor(y / 70 * h);
                    const idx = (sy * w + sx) * 4;
                    let val = ch.get(this.originalImageData.data[idx], this.originalImageData.data[idx+1], this.originalImageData.data[idx+2], this.originalImageData.data[idx+3]);
                    if (ch.max > ch.min) val = (val - ch.min) / (ch.max - ch.min) * 255;
                    else val = 128;
                    const didx = (y * 70 + x) * 4;
                    pdata.data[didx] = val;
                    pdata.data[didx+1] = val;
                    pdata.data[didx+2] = val;
                    pdata.data[didx+3] = 255;
                }
            }
            pctx.putImageData(pdata, 0, 0);
            const card = document.createElement('div');
            card.className = `channel-card ${this.channels[ch.key] ? 'active' : ''}`;
            card.innerHTML = `<img src="${previewCanvas.toDataURL()}" class="channel-preview"><div class="channel-name">${ch.name}</div>`;
            card.onclick = () => {
                this.channels[ch.key] = !this.channels[ch.key];
                this.applyChannels();
                card.classList.toggle('active', this.channels[ch.key]);
            };
            grid.appendChild(card);
        });
    }
    
    fitCanvasWithScale(scalePercent) {
        if (!this.currentImageData) return;
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        const containerWidth = container.clientWidth - 40;
        const containerHeight = 500;
        const imgWidth = this.currentImageData.width;
        const imgHeight = this.currentImageData.height;
        const userScale = scalePercent / 100;
        const fitScale = Math.min(containerWidth / imgWidth, containerHeight / imgHeight, 1);
        const finalScale = fitScale * userScale;
        this.canvas.style.width = `${imgWidth * finalScale}px`;
        this.canvas.style.height = `${imgHeight * finalScale}px`;
        this.canvas.width = imgWidth;
        this.canvas.height = imgHeight;
        this.ctx.putImageData(this.currentImageData, 0, 0);
        if (this.labScale) this.labScale.textContent = `${scalePercent}%`;
    }
    
    fitCanvas() {
        if (!this.currentImageData) return;
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        const containerWidth = container.clientWidth - 40;
        const containerHeight = 500;
        const imgWidth = this.currentImageData.width;
        const imgHeight = this.currentImageData.height;
        const scale = Math.min(containerWidth / imgWidth, containerHeight / imgHeight, 1);
        const scalePercent = Math.round(scale * 100);
        const scaleRange = document.getElementById('scaleRange');
        const scalePercentSpan = document.getElementById('scalePercent');
        if (scaleRange && scalePercentSpan && this.currentScale !== scalePercent) {
            this.currentScale = scalePercent;
            scaleRange.value = scalePercent;
            scalePercentSpan.textContent = `${scalePercent}%`;
            if (this.labScale) this.labScale.textContent = `${scalePercent}%`;
        }
        this.canvas.style.width = `${imgWidth * scale}px`;
        this.canvas.style.height = `${imgHeight * scale}px`;
        this.canvas.width = imgWidth;
        this.canvas.height = imgHeight;
        this.ctx.putImageData(this.currentImageData, 0, 0);
    }
    
    goToLab() {
        if (!this.originalImageData) { this.showToast('Сначала загрузите улику!', 'error'); return; }
        this.updateLabInfo();
        this.generateChannelPreviews();
        this.applyChannels();
        this.pageDossier.style.display = 'none';
        this.pageLab.style.display = 'block';
        this.fitCanvas();
    }
    
    goToDossier() {
        this.pageLab.style.display = 'none';
        this.pageDossier.style.display = 'block';
        this.eyedropperActive = false;
        this.eyedropperBtn.classList.remove('active');
        document.querySelector('.canvas-container')?.classList.remove('eyedropper-active');
        this.colorInfo.style.display = 'none';
    }
    
    updateLabInfo() {
        if (!this.originalImageData) return;
        this.labWidth.textContent = this.originalImageData.width;
        this.labHeight.textContent = this.originalImageData.height;
        this.labAlpha.textContent = this.hasMask ? 'ЕСТЬ' : 'НЕТ';
    }
    
    renderCanvas() {
        if (!this.currentImageData) return;
        this.canvas.width = this.currentImageData.width;
        this.canvas.height = this.currentImageData.height;
        this.ctx.putImageData(this.currentImageData, 0, 0);
        this.fitCanvas();
    }
    
    saveAsPNG() {
        if (!this.currentImageData) { this.showToast('Нет изображения', 'error'); return; }
        this.ctx.putImageData(this.currentImageData, 0, 0);
        this.canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `BLACKSAD_ДЕЛО_${this.caseNumber}.png`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('✓ Сохранено в PNG', 'success');
        });
    }
    
    saveAsJPG() {
        if (!this.currentImageData) { this.showToast('Нет изображения', 'error'); return; }
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.currentImageData.width;
        tempCanvas.height = this.currentImageData.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(this.currentImageData, 0, 0);
        tempCanvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `BLACKSAD_ДЕЛО_${this.caseNumber}.jpg`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('✓ Сохранено в JPG', 'success');
        }, 'image/jpeg', 0.92);
    }
    
    saveAsGB7() {
        if (!this.currentImageData) { this.showToast('Нет изображения', 'error'); return; }
        const useMask = this.hasMask;
        try {
            const buffer = GrayBit7Codec.encode(this.currentImageData, useMask);
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `BLACKSAD_ДЕЛО_${this.caseNumber}.gb7`;
            a.click();
            URL.revokeObjectURL(url);
            this.showToast(`✓ Сохранено в GB7`, 'success');
        } catch (err) {
            this.showToast(`Ошибка: ${err.message}`, 'error');
        }
    }
}

// ===== LEVELS TOOL =====
class LevelsTool {
    constructor(app) {
        this.app = app;
        this.levelsState = {
            master: { black: 0, gamma: 1.0, white: 255 },
            red: { black: 0, gamma: 1.0, white: 255 },
            green: { black: 0, gamma: 1.0, white: 255 },
            blue: { black: 0, gamma: 1.0, white: 255 },
            alpha: { black: 0, gamma: 1.0, white: 255 }
        };
        this.lutCache = { red: null, green: null, blue: null, alpha: null };
        this.currentChannel = 'master';
        this.histogramType = 'linear';
        this.previewActive = true;
        this.savedImageData = null;
        this.updateTimeout = null;
        this.init();
    }
    
    init() {
        this.dialog = document.getElementById('levelsDialog');
        this.levelsBtn = document.getElementById('levelsBtn');
        this.closeBtn = document.getElementById('closeDialogBtn');
        this.cancelBtn = document.getElementById('cancelLevelsBtn');
        this.resetBtn = document.getElementById('resetLevelsBtn');
        this.applyBtn = document.getElementById('applyLevelsBtn');
        this.previewCheckbox = document.getElementById('previewCheckbox');
        this.linearBtn = document.getElementById('linearBtn');
        this.logBtn = document.getElementById('logBtn');
        this.channelSelect = document.getElementById('levelsChannel');
        this.blackInput = document.getElementById('blackInput');
        this.gammaInput = document.getElementById('gammaInput');
        this.whiteInput = document.getElementById('whiteInput');
        this.blackValue = document.getElementById('blackValue');
        this.gammaValue = document.getElementById('gammaValue');
        this.whiteValue = document.getElementById('whiteValue');
        this.histogramCanvas = document.getElementById('histogramCanvas');
        
        this.levelsBtn.onclick = () => this.openDialog();
        this.closeBtn.onclick = () => this.closeDialog();
        this.cancelBtn.onclick = () => this.cancel();
        this.resetBtn.onclick = () => this.reset();
        this.applyBtn.onclick = () => this.apply();
        this.previewCheckbox.onchange = () => this.togglePreview();
        this.linearBtn.onclick = () => this.setHistogramType('linear');
        this.logBtn.onclick = () => this.setHistogramType('log');
        
        this.blackInput.oninput = () => this.scheduleUpdate();
        this.gammaInput.oninput = () => this.scheduleUpdate();
        this.whiteInput.oninput = () => this.scheduleUpdate();
        this.channelSelect.onchange = () => this.switchChannel();
    }
    
    scheduleUpdate() {
        if (this.updateTimeout) clearTimeout(this.updateTimeout);
        this.updateTimeout = setTimeout(() => {
            this.updateLevels();
            this.updateTimeout = null;
        }, 16);
    }
    
    openDialog() {
        if (!this.app.originalImageData) {
            this.app.showToast('Сначала загрузите изображение!', 'error');
            return;
        }
        this.savedImageData = this.app.cloneImageData(this.app.currentImageData);
        this.previewActive = true;
        this.previewCheckbox.checked = true;
        this.invalidateCache();
        this.dialog.showModal();
        this.updateHistogram();
        this.updateUIFromState();
    }
    
    closeDialog() { this.dialog.close(); if (this.updateTimeout) clearTimeout(this.updateTimeout); }
    
    cancel() {
        if (this.savedImageData) {
            this.app.currentImageData = this.savedImageData;
            this.app.renderCanvas();
        }
        this.closeDialog();
    }
    
    reset() {
        this.levelsState[this.currentChannel] = { black: 0, gamma: 1.0, white: 255 };
        this.invalidateCache();
        this.updateUIFromState();
        this.updateLevels();
    }
    
    apply() {
        this.savedImageData = this.app.cloneImageData(this.app.currentImageData);
        this.closeDialog();
    }
    
    togglePreview() {
        this.previewActive = this.previewCheckbox.checked;
        if (this.previewActive) {
            this.applyLevelsToImage();
        } else if (this.savedImageData) {
            this.app.currentImageData = this.savedImageData;
            this.app.renderCanvas();
        }
    }
    
    switchChannel() {
        this.currentChannel = this.channelSelect.value;
        this.invalidateCache();
        this.updateUIFromState();
        this.updateHistogram();
        if (this.previewActive) this.scheduleUpdate();
    }
    
    updateUIFromState() {
        const state = this.levelsState[this.currentChannel];
        this.blackInput.value = state.black;
        this.gammaInput.value = state.gamma;
        this.whiteInput.value = state.white;
        this.blackValue.textContent = state.black;
        this.gammaValue.textContent = state.gamma.toFixed(2);
        this.whiteValue.textContent = state.white;
    }
    
    updateLevels() {
        let black = parseInt(this.blackInput.value);
        let gamma = parseFloat(this.gammaInput.value);
        let white = parseInt(this.whiteInput.value);
        if (black >= white) {
            if (this.blackInput.value > this.whiteInput.value) this.blackInput.value = white - 1;
            else this.whiteInput.value = black + 1;
            return;
        }
        this.levelsState[this.currentChannel] = { black, gamma, white };
        this.blackValue.textContent = black;
        this.gammaValue.textContent = gamma.toFixed(2);
        this.whiteValue.textContent = white;
        this.invalidateCache();
        if (this.previewActive) this.applyLevelsToImage();
        this.updateHistogram();
    }
    
    invalidateCache() { this.lutCache = { red: null, green: null, blue: null, alpha: null }; }
    
    getLUT(channel) {
        const levels = this.getLevelsForChannel(channel);
        const key = `${levels.black}|${levels.gamma}|${levels.white}`;
        if (this.lutCache[channel] && this.lutCache[channel].key === key) return this.lutCache[channel].table;
        const table = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            let val = i;
            const { black, gamma, white } = levels;
            if (val <= black) table[i] = 0;
            else if (val >= white) table[i] = 255;
            else {
                let norm = (val - black) / (white - black);
                norm = Math.pow(norm, 1.0 / gamma);
                table[i] = Math.min(255, Math.max(0, Math.round(norm * 255)));
            }
        }
        this.lutCache[channel] = { key, table };
        return table;
    }
    
    getLevelsForChannel(ch) {
        const master = this.levelsState.master;
        const channel = this.levelsState[ch];
        if (this.currentChannel === 'master') return master;
        return {
            black: Math.max(master.black, channel.black),
            gamma: master.gamma * channel.gamma,
            white: Math.min(master.white, channel.white)
        };
    }
    
    applyLevelsToImage() {
        if (!this.app.originalImageData) return;
        const w = this.app.originalImageData.width;
        const h = this.app.originalImageData.height;
        const src = this.app.originalImageData.data;
        const lutR = this.getLUT('red');
        const lutG = this.getLUT('green');
        const lutB = this.getLUT('blue');
        const lutA = this.getLUT('alpha');
        const newData = new Uint8ClampedArray(src.length);
        for (let i = 0; i < w * h; i++) {
            const srcIdx = i * 4;
            const dstIdx = i * 4;
            newData[dstIdx] = lutR[src[srcIdx]];
            newData[dstIdx + 1] = lutG[src[srcIdx + 1]];
            newData[dstIdx + 2] = lutB[src[srcIdx + 2]];
            newData[dstIdx + 3] = lutA[src[srcIdx + 3]];
        }
        const newImageData = new ImageData(w, h);
        newImageData.data.set(newData);
        this.app.currentImageData = newImageData;
        this.app.renderCanvas();
    }
    
    setHistogramType(type) {
        this.histogramType = type;
        this.linearBtn.classList.toggle('active', type === 'linear');
        this.logBtn.classList.toggle('active', type === 'log');
        this.updateHistogram();
    }
    
    updateHistogram() { requestAnimationFrame(() => this._doUpdateHistogram()); }
    
    _doUpdateHistogram() {
        if (!this.app.originalImageData) return;
        const w = this.app.originalImageData.width;
        const h = this.app.originalImageData.height;
        const ch = this.currentChannel;
        const hist = new Array(256).fill(0);
        const data = this.app.originalImageData.data;
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            let val;
            if (ch === 'master') val = Math.round(0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2]);
            else if (ch === 'red') val = data[idx];
            else if (ch === 'green') val = data[idx+1];
            else if (ch === 'blue') val = data[idx+2];
            else val = data[idx+3];
            hist[val]++;
        }
        let maxCount = Math.max(...hist);
        let histData = [...hist];
        if (this.histogramType === 'log') {
            histData = histData.map(v => v === 0 ? 0 : Math.log(v + 1));
            maxCount = Math.max(...histData);
        }
        histData = histData.map(v => (v / maxCount) * 100);
        this.drawHistogram(histData);
    }
    
    drawHistogram(data) {
        const ctx = this.histogramCanvas.getContext('2d');
        const w = this.histogramCanvas.width;
        const h = this.histogramCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0B0D12';
        ctx.fillRect(0, 0, w, h);
        const barW = w / 256;
        for (let i = 0; i < 256; i++) {
            const barH = (data[i] / 100) * h;
            if (barH > 0) {
                ctx.fillStyle = '#D6A56A';
                ctx.fillRect(i * barW, h - barH, barW - 0.5, barH);
            }
        }
        const levels = this.levelsState[this.currentChannel];
        const blackX = (levels.black / 255) * w;
        const whiteX = (levels.white / 255) * w;
        ctx.beginPath();
        ctx.strokeStyle = '#7E2F2F';
        ctx.lineWidth = 2;
        ctx.moveTo(blackX, 0);
        ctx.lineTo(blackX, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = '#556043';
        ctx.moveTo(whiteX, 0);
        ctx.lineTo(whiteX, h);
        ctx.stroke();
    }
}

// ===== SCALE TOOL =====
class ScaleTool {
    constructor(app) {
        this.app = app;
        this.currentScale = 100;
        this.init();
    }
    
    showInfoToast(message) {
        const toast = document.getElementById('infoToast');
        if (!toast) return;
        const toastText = toast.querySelector('.info-toast-text');
        toastText.textContent = message;
        toast.style.display = 'flex';
        toast.style.animation = 'fadeInUp 0.3s ease';
        setTimeout(() => {
            toast.style.animation = 'fadeOutDown 0.3s ease';
            setTimeout(() => {
                toast.style.display = 'none';
                toast.style.animation = '';
            }, 300);
        }, 4000);
    }
    
    init() {
        this.scaleRange = document.getElementById('scaleRange');
        this.scalePercent = document.getElementById('scalePercent');
        this.scaleDialogBtn = document.getElementById('scaleDialogBtn');
        this.scaleDialog = document.getElementById('scaleDialog');
        this.closeScaleDialogBtn = document.getElementById('closeScaleDialogBtn');
        this.cancelScaleBtn = document.getElementById('cancelScaleBtn');
        this.applyScaleBtn = document.getElementById('applyScaleBtn');
        this.scaleUnit = document.getElementById('scaleUnit');
        this.scaleWidth = document.getElementById('scaleWidth');
        this.scaleHeight = document.getElementById('scaleHeight');
        this.keepAspect = document.getElementById('keepAspect');
        this.interpolationMethod = document.getElementById('interpolationMethod');
        this.pixelsBefore = document.getElementById('pixelsBefore');
        this.pixelsAfter = document.getElementById('pixelsAfter');
        this.widthUnit = document.getElementById('widthUnit');
        this.heightUnit = document.getElementById('heightUnit');
        
        this.scaleRange.oninput = () => this.updateScaleFromRange();
        this.scaleDialogBtn.onclick = () => this.openDialog();
        this.closeScaleDialogBtn.onclick = () => this.scaleDialog.close();
        this.cancelScaleBtn.onclick = () => this.scaleDialog.close();
        this.applyScaleBtn.onclick = () => this.applyScale();
        this.scaleUnit.onchange = () => this.toggleUnits();
        this.scaleWidth.oninput = () => this.updateHeightFromAspect();
        this.scaleHeight.oninput = () => this.updateWidthFromAspect();
        this.keepAspect.onchange = () => this.updateHeightFromAspect();
        
        this.updateTooltipText();
        this.addTooltipListener();
        this.interpolationMethod.onchange = () => this.updateTooltipText();
    }
    
    updateTooltipText() {
        const method = this.interpolationMethod.value;
        const tooltip = document.getElementById('interpolationTooltip');
        if (method === 'bilinear') {
            tooltip.textContent = 'Билинейная интерполяция — вычисляет взвешенное среднее 4 соседних пикселей. Даёт более гладкое изображение.';
        } else {
            tooltip.textContent = 'Ближайший сосед — выбирает значение ближайшего пикселя. Быстрее, но может давать пикселизацию.';
        }
    }
    
    addTooltipListener() {
        const tooltipIcon = document.querySelector('.tooltip-icon');
        if (tooltipIcon) {
            tooltipIcon.onclick = (e) => {
                e.stopPropagation();
                const method = this.interpolationMethod.value;
                if (method === 'bilinear') {
                    this.showInfoToast('Билинейная интерполяция — вычисляет взвешенное среднее 4 соседних пикселей. Даёт более гладкое изображение, рекомендуется для увеличения.');
                } else {
                    this.showInfoToast('Ближайший сосед — выбирает значение ближайшего пикселя. Быстрее, но может давать пикселизацию. Хорошо для чётких границ.');
                }
            };
        }
    }
    
    toggleUnits() {
        const isPercent = this.scaleUnit.value === 'percent';
        this.widthUnit.textContent = isPercent ? '%' : 'px';
        this.heightUnit.textContent = isPercent ? '%' : 'px';
        if (!this.app.originalImageData) return;
        const origW = this.app.originalImageData.width;
        const origH = this.app.originalImageData.height;
        if (isPercent) {
            this.scaleWidth.value = 100;
            this.scaleHeight.value = 100;
            this.scaleWidth.max = 300;
            this.scaleWidth.min = 12;
            this.scaleHeight.max = 300;
            this.scaleHeight.min = 12;
        } else {
            this.scaleWidth.value = origW;
            this.scaleHeight.value = origH;
            this.scaleWidth.max = Math.min(origW * 3, 8000);
            this.scaleWidth.min = Math.max(Math.floor(origW * 0.12), 1);
            this.scaleHeight.max = Math.min(origH * 3, 8000);
            this.scaleHeight.min = Math.max(Math.floor(origH * 0.12), 1);
        }
        this.updatePixelInfo();
    }
    
    updatePixelInfo() {
        if (!this.app.originalImageData) return;
        const origPixels = (this.app.originalImageData.width * this.app.originalImageData.height) / 1000000;
        this.pixelsBefore.textContent = origPixels.toFixed(2);
        let newW = parseInt(this.scaleWidth.value);
        let newH = parseInt(this.scaleHeight.value);
        if (this.scaleUnit.value === 'percent') {
            newW = Math.round(this.app.originalImageData.width * newW / 100);
            newH = Math.round(this.app.originalImageData.height * newH / 100);
        }
        const newPixels = (newW * newH) / 1000000;
        this.pixelsAfter.textContent = newPixels.toFixed(2);
    }
    
    updateHeightFromAspect() {
        if (!this.keepAspect.checked || !this.app.originalImageData) return;
        const origW = this.app.originalImageData.width;
        const origH = this.app.originalImageData.height;
        const aspect = origH / origW;
        let newW = parseInt(this.scaleWidth.value);
        let newH = Math.round(newW * aspect);
        if (this.scaleUnit.value === 'percent') {
            newH = Math.min(300, Math.max(12, newH));
        } else {
            newH = Math.min(this.scaleHeight.max, Math.max(this.scaleHeight.min, newH));
        }
        this.scaleHeight.value = newH;
        this.updatePixelInfo();
    }
    
    updateWidthFromAspect() {
        if (!this.keepAspect.checked || !this.app.originalImageData) return;
        const origW = this.app.originalImageData.width;
        const origH = this.app.originalImageData.height;
        const aspect = origW / origH;
        let newH = parseInt(this.scaleHeight.value);
        let newW = Math.round(newH * aspect);
        if (this.scaleUnit.value === 'percent') {
            newW = Math.min(300, Math.max(12, newW));
        } else {
            newW = Math.min(this.scaleWidth.max, Math.max(this.scaleWidth.min, newW));
        }
        this.scaleWidth.value = newW;
        this.updatePixelInfo();
    }
    
    openDialog() {
        if (!this.app.originalImageData) {
            this.app.showToast('Сначала загрузите изображение!', 'error');
            return;
        }
        this.toggleUnits();
        this.updatePixelInfo();
        this.scaleDialog.showModal();
    }
    
    applyScale() {
        if (!this.app.originalImageData) return;
        let newW = parseInt(this.scaleWidth.value);
        let newH = parseInt(this.scaleHeight.value);
        if (isNaN(newW) || isNaN(newH) || newW < 1 || newH < 1) {
            this.app.showToast('Введите корректные размеры!', 'error');
            return;
        }
        if (this.scaleUnit.value === 'percent') {
            newW = Math.round(this.app.originalImageData.width * newW / 100);
            newH = Math.round(this.app.originalImageData.height * newH / 100);
        }
        newW = Math.min(8000, Math.max(1, newW));
        newH = Math.min(8000, Math.max(1, newH));
        const method = this.interpolationMethod.value;
        this.app.showToast(`Масштабирование: ${this.app.originalImageData.width}×${this.app.originalImageData.height} → ${newW}×${newH} (${method === 'bilinear' ? 'билинейная' : 'ближайший сосед'})`, 'info');
        const newImageData = ImageScaler.scale(this.app.originalImageData, newW, newH, method);
        this.app.originalImageData = newImageData;
        this.app.currentImageData = this.app.cloneImageData(newImageData);
        this.currentScale = 100;
        this.scaleRange.value = 100;
        this.scalePercent.textContent = '100%';
        if (this.app.labScale) this.app.labScale.textContent = '100%';
        this.app.generateChannelPreviews();
        this.app.applyChannels();
        this.app.renderCanvas();
        this.scaleDialog.close();
        const labWidth = document.getElementById('labWidth');
        const labHeight = document.getElementById('labHeight');
        if (labWidth) labWidth.textContent = newW;
        if (labHeight) labHeight.textContent = newH;
        this.app.showToast(`✓ Изображение масштабировано до ${newW}×${newH}`, 'success');
    }
    
    updateScaleFromRange() {
        this.currentScale = parseInt(this.scaleRange.value);
        this.scalePercent.textContent = `${this.currentScale}%`;
        if (this.app.labScale) this.app.labScale.textContent = `${this.currentScale}%`;
        if (this.app.currentImageData) {
            this.app.fitCanvasWithScale(this.currentScale);
        }
    }
}

// ===== FILTERS TOOL =====
class FiltersTool {
    constructor(app) {
        this.app = app;
        this.savedImageData = null;
        this.updateTimeout = null;
        this.init();
    }
    
    init() {
        this.dialog = document.getElementById('filtersDialog');
        this.filtersBtn = document.getElementById('filtersBtn');
        this.closeBtn = document.getElementById('closeFiltersDialogBtn');
        this.cancelBtn = document.getElementById('cancelFiltersBtn');
        this.resetBtn = document.getElementById('resetFiltersBtn');
        this.applyBtn = document.getElementById('applyFiltersBtn');
        this.presetSelect = document.getElementById('presetFilter');
        this.previewCheckbox = document.getElementById('filterPreviewCheckbox');
        
        this.kernelCells = [];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                this.kernelCells.push(document.getElementById(`k${i}${j}`));
            }
        }
        this.divisorInput = document.getElementById('kernelDivisor');
        this.channelRed = document.getElementById('channelRed');
        this.channelGreen = document.getElementById('channelGreen');
        this.channelBlue = document.getElementById('channelBlue');
        this.channelAlpha = document.getElementById('channelAlpha');
        this.edgeStrategy = document.getElementById('edgeStrategy');
        
        this.filtersBtn.onclick = () => this.openDialog();
        this.closeBtn.onclick = () => this.dialog.close();
        this.cancelBtn.onclick = () => this.cancel();
        this.resetBtn.onclick = () => this.reset();
        this.applyBtn.onclick = () => this.apply();
        this.presetSelect.onchange = () => this.loadPreset();
        this.previewCheckbox.onchange = () => this.togglePreview();
        
        const updateKernel = () => this.scheduleUpdate();
        this.kernelCells.forEach(cell => cell.oninput = updateKernel);
        this.divisorInput.oninput = updateKernel;
        this.edgeStrategy.onchange = () => this.scheduleUpdate();
        [this.channelRed, this.channelGreen, this.channelBlue, this.channelAlpha].forEach(ch => {
            ch.onchange = () => this.scheduleUpdate();
        });
    }
    
    scheduleUpdate() {
        if (this.updateTimeout) clearTimeout(this.updateTimeout);
        this.updateTimeout = setTimeout(() => {
            if (this.previewCheckbox.checked) {
                this.applyFilterToImage();
            }
            this.updateTimeout = null;
        }, 50);
    }
    
    loadPreset() {
        const preset = this.presetSelect.value;
        let kernel, divisor;
        switch(preset) {
            case 'identity':
                kernel = [[0,0,0],[0,1,0],[0,0,0]];
                divisor = 1;
                break;
            case 'sharpen':
                kernel = [[0,-1,0],[-1,5,-1],[0,-1,0]];
                divisor = 1;
                break;
            case 'gaussian':
                kernel = [[1,2,1],[2,4,2],[1,2,1]];
                divisor = 16;
                break;
            case 'box':
                kernel = [[1,1,1],[1,1,1],[1,1,1]];
                divisor = 9;
                break;
            case 'prewitt-x':
                kernel = [[-1,0,1],[-1,0,1],[-1,0,1]];
                divisor = 1;
                break;
            case 'prewitt-y':
                kernel = [[-1,-1,-1],[0,0,0],[1,1,1]];
                divisor = 1;
                break;
            default: return;
        }
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                this.kernelCells[i*3 + j].value = kernel[i][j];
            }
        }
        this.divisorInput.value = divisor;
        this.scheduleUpdate();
    }
    
    getKernel() {
        const kernel = [];
        for (let i = 0; i < 3; i++) {
            const row = [];
            for (let j = 0; j < 3; j++) {
                row.push(parseFloat(this.kernelCells[i*3 + j].value) || 0);
            }
            kernel.push(row);
        }
        const divisor = parseFloat(this.divisorInput.value) || 1;
        return { kernel, divisor };
    }
    
    getEdgeValue(strategy, src, x, y, w, h, channel) {
        if (x >= 0 && x < w && y >= 0 && y < h) {
            return src[(y * w + x) * 4 + channel];
        }
        switch(strategy) {
            case 'black': return 0;
            case 'white': return 255;
            case 'extend':
                const ex = Math.min(Math.max(x, 0), w - 1);
                const ey = Math.min(Math.max(y, 0), h - 1);
                return src[(ey * w + ex) * 4 + channel];
            default: return 0;
        }
    }
    
    applyFilterToImage() {
        if (!this.app.originalImageData) return;
        const { kernel, divisor } = this.getKernel();
        const strategy = this.edgeStrategy.value;
        const applyToRed = this.channelRed.checked;
        const applyToGreen = this.channelGreen.checked;
        const applyToBlue = this.channelBlue.checked;
        const applyToAlpha = this.channelAlpha.checked;
        const src = this.app.originalImageData.data;
        const w = this.app.originalImageData.width;
        const h = this.app.originalImageData.height;
        const newData = new Uint8ClampedArray(src.length);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const weight = kernel[ky+1][kx+1];
                        const ix = x + kx;
                        const iy = y + ky;
                        sumR += this.getEdgeValue(strategy, src, ix, iy, w, h, 0) * weight;
                        sumG += this.getEdgeValue(strategy, src, ix, iy, w, h, 1) * weight;
                        sumB += this.getEdgeValue(strategy, src, ix, iy, w, h, 2) * weight;
                        sumA += this.getEdgeValue(strategy, src, ix, iy, w, h, 3) * weight;
                    }
                }
                const idx = (y * w + x) * 4;
                if (applyToRed) {
                    let val = sumR / divisor;
                    newData[idx] = Math.min(255, Math.max(0, Math.round(val)));
                } else { newData[idx] = src[idx]; }
                if (applyToGreen) {
                    let val = sumG / divisor;
                    newData[idx+1] = Math.min(255, Math.max(0, Math.round(val)));
                } else { newData[idx+1] = src[idx+1]; }
                if (applyToBlue) {
                    let val = sumB / divisor;
                    newData[idx+2] = Math.min(255, Math.max(0, Math.round(val)));
                } else { newData[idx+2] = src[idx+2]; }
                if (applyToAlpha) {
                    let val = sumA / divisor;
                    newData[idx+3] = Math.min(255, Math.max(0, Math.round(val)));
                } else { newData[idx+3] = src[idx+3]; }
            }
        }
        const newImageData = new ImageData(w, h);
        newImageData.data.set(newData);
        this.app.currentImageData = newImageData;
        this.app.renderCanvas();
    }
    
    openDialog() {
        if (!this.app.originalImageData) {
            this.app.showToast('Сначала загрузите изображение!', 'error');
            return;
        }
        this.savedImageData = this.app.cloneImageData(this.app.currentImageData);
        this.dialog.showModal();
        this.loadPreset();
        this.previewCheckbox.checked = true;
    }
    
    cancel() {
        if (this.savedImageData) {
            this.app.currentImageData = this.savedImageData;
            this.app.renderCanvas();
        }
        this.dialog.close();
    }
    
    reset() {
        this.loadPreset();
        if (this.previewCheckbox.checked) this.applyFilterToImage();
    }
    
    apply() {
        this.savedImageData = this.app.cloneImageData(this.app.currentImageData);
        this.dialog.close();
    }
    
    togglePreview() {
        if (this.previewCheckbox.checked) {
            this.applyFilterToImage();
        } else if (this.savedImageData) {
            this.app.currentImageData = this.savedImageData;
            this.app.renderCanvas();
        }
    }
}

// ===== ЗАПУСК =====
document.addEventListener('DOMContentLoaded', () => {
    window.detectiveApp = new DetectiveCase();
    window.levelsTool = new LevelsTool(window.detectiveApp);
    window.scaleTool = new ScaleTool(window.detectiveApp);
    window.filtersTool = new FiltersTool(window.detectiveApp);
});
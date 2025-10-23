// Cookie helpers and small utilities

export function setCookie(name, value, days) {
    const expires = (() => {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        return "; expires=" + date.toUTCString();
    })();
    document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/";
}

export function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
}

export function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

export function formatDateTime(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

export function generateId(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function base64EncodeJson(obj) {
    return btoa(encodeURIComponent(JSON.stringify(obj)));
}

export function base64DecodeJson(b64) {
    return JSON.parse(decodeURIComponent(atob(b64)));
}

export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function isValidImageFile(file) {
    return file && file.type && file.type.startsWith('image/');
}

// Upload image to external service with multiple fallbacks
export async function uploadImageToExternal(file) {
    // Try services in order: ImgBB (configured) -> PostImages (no key needed)
    const services = [
        () => uploadToImgBB(file),
        () => uploadToPostImages(file)
    ];

    for (const service of services) {
        try {
            return await service();
        } catch (error) {
            console.warn('Service failed, trying next:', error.message);
        }
    }

    throw new Error('All image hosting services failed');
}

// ImgBB - Free service with API key
async function uploadToImgBB(file) {
    // TODO: Replace with your actual API key from imgbb.com
    const API_KEY = '57ea63b8f4cc45d8265e23de14f7d134';

    // API key is configured, proceed with upload

    try {
        const compressedDataUrl = await compressImage(file, 1200, 0.85);
        const base64Data = compressedDataUrl.split(',')[1];

        const formData = new FormData();
        formData.append('image', base64Data);

        const response = await fetch(`https://api.imgbb.com/1/upload?key=${API_KEY}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ImgBB upload failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        if (result.success && result.data && result.data.url) {
            return { url: result.data.url, service: 'ImgBB' };
        }

        throw new Error('Invalid ImgBB response');
    } catch (error) {
        throw new Error(`ImgBB: ${error.message}`);
    }
}

// PostImages - Alternative service (no API key needed, but may have CORS issues)
async function uploadToPostImages(file) {
    try {
        // PostImages often has CORS issues, so we'll compress the image first
        const compressedDataUrl = await compressImage(file, 1200, 0.85);
        const response = await fetch(compressedDataUrl);
        const blob = await response.blob();

        const formData = new FormData();
        formData.append('upload', blob, 'image.jpg');
        formData.append('optsize', '0');
        formData.append('expire', '0');

        const uploadResponse = await fetch('https://postimages.org/json/rr', {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            throw new Error(`PostImages upload failed: ${uploadResponse.status}`);
        }

        const result = await uploadResponse.json();
        if (result.status === 'OK' && result.url) {
            return { url: result.url, service: 'PostImages' };
        }

        throw new Error(`PostImages error: ${result.status || 'Unknown error'}`);
    } catch (error) {
        throw new Error(`PostImages: ${error.message}`);
    }
}

// Imgur removed - API key not available

export function compressImage(file, maxWidth = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            // Calculate new dimensions with more aggressive sizing
            let { width, height } = img;

            // More aggressive resizing for URLs
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }

            // Additional size reduction if still too large
            const maxPixels = 400000; // ~640x625 or equivalent
            if (width * height > maxPixels) {
                const ratio = Math.sqrt(maxPixels / (width * height));
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;

            // Draw and compress with optimized settings
            ctx.fillStyle = '#FFFFFF'; // White background for JPEG
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            // Try different qualities to find the best size/quality balance
            let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

            // If still too large, reduce quality further
            if (compressedDataUrl.length > 50000 && quality > 0.3) { // ~37KB base64 limit
                compressedDataUrl = canvas.toDataURL('image/jpeg', 0.3);
            }

            resolve(compressedDataUrl);
        };

        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// Simplified compression using only base64 (more reliable)
export function compressData(data) {
    try {
        // Convert to JSON string and compress with base64
        const jsonStr = JSON.stringify(data);
        return Promise.resolve(btoa(encodeURIComponent(jsonStr)));
    } catch (e) {
        return Promise.reject(e);
    }
}

export function decompressData(compressedData) {
    try {
        // Simple base64 decode
        const jsonStr = decodeURIComponent(atob(compressedData));
        return Promise.resolve(JSON.parse(jsonStr));
    } catch (e) {
        return Promise.reject(e);
    }
}



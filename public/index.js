document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const loading = document.getElementById('loading');
    const resultContainer = document.getElementById('result-container');
    const previewImage = document.getElementById('preview-image');
    const resultTitle = document.getElementById('result-title');
    const resultText = document.getElementById('result-text');
    const playBtn = document.getElementById('play-btn');
    // 使用上傳時的語言選擇器
    const uploadLanguageSelector = document.getElementById('upload-language-selector');

    let selectedFile = null;
    let audioContext = null;
    let audioSource = null;
    let currentAudio = null;
    let currentResponse = null;

    // 載入可用的語言選項
    async function loadAvailableLanguages() {
        try {
            // 獲取當前選中的語言值
            const currentSelectedLang = uploadLanguageSelector.value;

            // 顯示載入中狀態
            uploadLanguageSelector.disabled = true;

            // 從API獲取支援的語言列表
            const response = await fetch('/api/languages');
            if (!response.ok) {
                throw new Error(`無法獲取語言列表: ${response.status}`);
            }

            const data = await response.json();
            if (data && data.translation) {
                // 清空當前的選項
                uploadLanguageSelector.innerHTML = '';

                // 將API返回的語言添加為選項
                Object.keys(data.translation).forEach(langCode => {
                    console.log('langCode', langCode);

                    const langInfo = data.translation[langCode];
                    const option = document.createElement('option');
                    option.value = langCode;
                    option.textContent = `${langInfo.name} (${langInfo.nativeName})`;

                    // 如果是之前選中的語言，設置為選中
                    if (langCode === currentSelectedLang) {
                        option.selected = true;
                    }

                    uploadLanguageSelector.appendChild(option);
                });

                console.log('語言選項已更新，共載入', Object.keys(data.translation).length, '種語言');
            } else {
                console.error('API返回的語言數據格式不正確', data);
            }
        } catch (error) {
            console.error('載入語言列表失敗:', error);
            // 載入失敗時，保持原有的語言選項
        } finally {
            uploadLanguageSelector.disabled = false;
        }
    }

    // 頁面載入時獲取可用語言列表
    loadAvailableLanguages();

    // 初始化音頻上下文
    function initAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // 處理文件選擇
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    // 拖放處理
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#0d6efd';
        uploadArea.style.backgroundColor = '#f8f9ff';
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#dee2e6';
        uploadArea.style.backgroundColor = '';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#dee2e6';
        uploadArea.style.backgroundColor = '';

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleFile(file);
        }
    });

    // 文件選擇事件
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFile(fileInput.files[0]);
        }
    });

    // 處理選擇的檔案
    function handleFile(file) {
        selectedFile = file;

        // 顯示預覽區域
        document.getElementById('preview-container').style.display = 'block';

        const reader = new FileReader();
        reader.onload = (e) => {
            // 只設置上傳預覽圖，不設置結果預覽圖
            document.getElementById('upload-preview').src = e.target.result;
            // 移除自動設置結果預覽圖的行為，等API回傳的imgurl使用
        };
        reader.readAsDataURL(file);

        // 清除上一次的結果並直接上傳分析
        resultContainer.style.display = 'none';
        uploadImage(file);
    }

    // 上傳圖片到API
    async function uploadImage(file) {
        // 清除上一次的結果
        resultContainer.style.display = 'none';
        resultTitle.textContent = '景點資訊';
        resultText.textContent = '';

        loading.style.display = 'block';
        playBtn.disabled = true;

        // 獲取選擇的語言
        const selectedLanguage = uploadLanguageSelector.value;

        const formData = new FormData();
        formData.append('image', file);
        formData.append('language', selectedLanguage); // 添加語言參數

        try {
            const response = await fetch('/api/analyzeimage', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            currentResponse = data;

            displayResult(data);
        } catch (error) {
            console.error('圖片上傳失敗:', error);
            alert('上傳失敗: ' + error.message);
        } finally {
            loading.style.display = 'none';
        }
    }

    // 顯示分析結果
    function displayResult(data) {
        resultContainer.style.display = 'block';

        const response = data.response;

        // 使用API回傳的imgurl屬性來設定preview-image的圖片來源
        if (data.imgurl) {
            previewImage.src = data.imgurl;
        }

        if (response.type === 'success') {
            resultTitle.textContent = data.results[0]?.title || '景點資訊';
            resultText.textContent = response.text;

            // 若有音頻數據，啟用播放按鈕
            if (response.audio && response.audio.content) {
                playBtn.disabled = false;
            } else {
                playBtn.disabled = true;
            }
        } else {
            resultTitle.textContent = '無法識別';
            resultText.textContent = response.text;
            playBtn.disabled = true;
        }

        window.scrollTo({
            top: resultContainer.offsetTop - 20,
            behavior: 'smooth'
        });
    }

    // 播放按鈕點擊事件
    playBtn.addEventListener('click', async () => {
        initAudioContext();

        if (currentAudio && !currentAudio.paused) {
            // 如果音頻正在播放，則暫停並發送停止請求到後端
            currentAudio.pause();
            playBtn.innerHTML = '<i class="bi bi-play-fill"></i> 播放語音導覽';
            return;
        }

        // 使用上傳時選擇的語言
        const selectedLang = uploadLanguageSelector.value;

        // 檢查是否有音頻數據，且語言匹配
        if (currentResponse && currentResponse.response.audio &&
            currentResponse.response.audio.content &&
            currentResponse.response.language === selectedLang) {
            // 使用現有音頻
            playAudio(currentResponse.response.audio.content, currentResponse.response.audio.contentType);
        } else {
            // 如果語言不匹配，重新生成語音
            await generateSpeech(selectedLang);
        }
    });

    // 播放音頻數據
    function playAudio(base64Audio, contentType = 'audio/mp3') {
        // 將 Base64 轉換為 Blob
        const byteCharacters = atob(base64Audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: contentType });

        // 創建URL並播放
        const audioUrl = URL.createObjectURL(blob);
        currentAudio = new Audio(audioUrl);

        // 更改按鈕狀態和圖標
        playBtn.innerHTML = '<i class="bi bi-pause-fill"></i> 暫停播放';

        currentAudio.addEventListener('ended', () => {
            playBtn.innerHTML = '<i class="bi bi-play-fill"></i> 播放語音導覽';
        });

        currentAudio.addEventListener('pause', () => {
            playBtn.innerHTML = '<i class="bi bi-play-fill"></i> 播放語音導覽';
        });

        currentAudio.addEventListener('play', () => {
            playBtn.innerHTML = '<i class="bi bi-pause-fill"></i> 暫停播放';
        });

        currentAudio.play();
    }



    // 根據使用者選擇的語言生成新的語音和翻譯文字
    async function generateSpeech(language = 'zh') {
        if (!currentResponse || !currentResponse.response) {
            alert('沒有可用的景點資訊。');
            return;
        }

        try {
            playBtn.disabled = true;
            playBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> 生成語音中...';

            // 發送請求到後端 API 來獲取新的語言版本
            const response = await fetch('/api/translate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: currentResponse.response.source.content || currentResponse.response.text,
                    language: language,
                    originalContent: currentResponse.response.source
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // 更新顯示的文字
            resultText.textContent = data.text;

            // 更新語音數據
            if (data.audio && data.audio.content) {
                currentResponse.response.audio = data.audio;
                currentResponse.response.language = language;
                currentResponse.response.text = data.text;

                // 播放新的語音
                playAudio(data.audio.content, data.audio.contentType);
            } else {
                alert('無法生成所選語言的語音。');
            }
        } catch (error) {
            console.error('語音生成失敗:', error);
            alert('語音生成失敗: ' + error.message);
        } finally {
            playBtn.disabled = false;
        }
    }

    // 上傳語言選擇器變更事件 - 如果用戶在上傳前更改了語言選擇
    uploadLanguageSelector.addEventListener('change', () => {
        // 只需記錄語言變更，實際處理會在上傳時進行
        console.log('語言選擇已更改為:', uploadLanguageSelector.value);
    });
});
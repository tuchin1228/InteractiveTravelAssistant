// server.js - 互動式旅遊導覽 Agent Express 服務器
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// Azure AI SDK imports
const TextTranslationClient =
    require("@azure-rest/ai-translation-text").default;
const { AzureKeyCredential } = require("@azure/core-auth");
const {
    SpeechConfig,
    AudioConfig,
    SpeechRecognizer,
    SpeechSynthesizer,
    ResultReason,
    CancellationReason,
    SpeechSynthesisOutputFormat
} = require("microsoft-cognitiveservices-speech-sdk");
const { SearchClient } = require("@azure/search-documents");
const { AzureOpenAI } = require("openai");
const axios = require("axios");
const { text } = require("stream/consumers");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件設定
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));
app.use("/audio", express.static("audio_output"));


// 檔案上傳設定
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = "./uploads";
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});
const upload = multer({ storage: storage });



// 全域服務客戶端
let visionClient, speechConfig, translationClient, searchClient;

// 🚀 初始化 Azure AI 服務
function initializeAzureServices() {
    try {
        // Speech 服務
        speechConfig = SpeechConfig.fromSubscription(
            process.env.AZURE_SPEECH_KEY,
            process.env.AZURE_SPEECH_REGION
        );

        // Translation 服務
        translationClient = new TextTranslationClient(
            process.env.AZURE_TRANSLATION_ENDPOINT,
            new AzureKeyCredential(process.env.AZURE_TRANSLATION_KEY)
        );

        console.log("✅ 所有 Azure AI 服務初始化完成");
    } catch (error) {
        console.error("❌ Azure AI 服務初始化失敗:", error);
    }
}


// 🚀 啟動伺服器
async function startServer() {
    // 初始化 Azure AI 服務
    initializeAzureServices();

    app.listen(PORT, () => {
        console.log(`
        🚀 互動式旅遊導覽 Agent 服務器已啟動
        📍 http://localhost:${PORT}
        `);
    });
}

// 優雅關閉
process.on("SIGINT", () => {
    console.log("\n👋 正在關閉服務器...");
    process.exit(0);
});





// 🔍 搜尋景點函數
async function searchAttractions(imageBuffer) {
    try {
        console.log("🔍 搜尋相關景點");



        const searchOptions = {
            "search": "*",
            "count": true,
            "vectorQueries": [
                {
                    "kind": "imageBinary",
                    "base64Image": imageBuffer.toString("base64"),
                    "fields": "content_embedding"
                }
            ],
            "queryType": "semantic",
            "semanticConfiguration": "multimodal-rag-1753341671830-semantic-configuration",
            "captions": "extractive",
            "answers": "extractive|count-3",
            "queryLanguage": "en-us"
        }

        // const searchResults = await searchClient.search(`simple`, searchOptions);

        const searchResults = await axios.post(
            `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX}/docs/search?api-version=2025-05-01-Preview`,
            searchOptions,
            {
                headers: {
                    "Content-Type": "application/json",
                    "api-key": process.env.AZURE_SEARCH_KEY,
                },
            }
        );
        console.log("🔍 搜尋結果:", searchResults?.data?.value[0]);
        const results = searchResults?.data?.value


        return results;
    } catch (error) {
        console.error("❌ 景點搜尋失敗:", error);
        return [];
    }
}


// 🤖 生成智能回應函數
async function generateResponse(searchResults) {
    try {
        console.log("🤖 生成智能回應...");

        if (searchResults.length === 0) {
            return {
                type: "no_results",
                text: "很抱歉，我無法識別這個景點或找到相關資訊。請嘗試提供更清楚的照片或詳細描述。",
                suggestions: ["拍攝更清楚的照片", "提供景點名稱", "描述周邊環境特徵"],
            };
        }

        // 使用 Azure OpenAI SDK 生成回應 (使用 API 金鑰方式)
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "your-openai-endpoint";
        const apiKey = process.env.AZURE_OPENAI_KEY || "your-openai-key";
        const deployment = "gpt-4o";
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2023-05-15";

        // 使用標準的 API 金鑰驗證
        const client = new AzureOpenAI({
            apiKey: apiKey,
            endpoint: endpoint,
            deployment: deployment,
            apiVersion: apiVersion
        });

        const events = await client.chat.completions.create({
            messages: [
                { role: "system", content: "你是一個資深導遊，擅長提供旅遊建議和景點資訊。" },
                {
                    role: "user", content: ` ${searchResults[0]?.content_text}。
                根據以上資料，生成結果為一段文字敘述，內容必須包含:
                1.景點名稱(name)
                2.景點歷史(history)
                3.景點描述(description)
                4.景點開放時間(opening_hours)
                並確保文字敘述流暢、通順。` },
            ],
            model: "gpt-4o",
            temperature: 0.7,
        });
        const response = events.choices[0].message.content;
        console.log("🤖 回應生成成功:", response);

        // 返回生成的回應
        return {
            type: "success",
            text: response,
            source: {
                title: searchResults[0]?.title || "未知景點",
                content: searchResults[0]?.content_text || ""
            }
        };

    } catch (error) {
        console.error("❌ 回應生成失敗:", error);
        throw error;
    }
}


// 翻譯 OpenAI 回應
async function translateResponse(responseText, targetLanguage = "zh-Hant") {
    try {
        console.log("🌐 開始翻譯回應...");



        const inputText = [{ text: responseText }];
        const parameters = {
            to: targetLanguage,
            from: "zh",
        };
        const translateResponse = await translationClient.path("/translate").post({
            body: inputText,
            queryParameters: parameters,
        });

        return translateResponse?.body[0]?.translations[0]?.text


    } catch (error) {
        console.error("❌ 翻譯失敗:", error);
        return responseText;
    }
}


// 1. 網路連接測試
async function testNetworkConnectivity() {
    console.log('🌐 測試網路連接性...');

    const testUrls = [
        'https://cognitiveservices.azure.com',
        `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com`,
        'https://eastus.tts.speech.microsoft.com' // 備用測試
    ];

    for (const url of testUrls) {
        try {
            console.log(`測試連接: ${url}`);
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Azure-Speech-Test/1.0'
                }
            });
            console.log(`✅ ${url} - 狀態: ${response.status}`);
        } catch (error) {
            console.error(`❌ ${url} - 錯誤: ${error.message}`);
            if (error.code === 'ENOTFOUND') {
                console.error('   DNS 解析失敗，可能是網路連接問題');
            } else if (error.code === 'ECONNREFUSED') {
                console.error('   連接被拒絕，可能是防火牆問題');
            } else if (error.code === 'ETIMEDOUT') {
                console.error('   連接超時，可能是網路延遲問題');
            }
        }
    }
}

// 2. Azure Speech 服務健康檢查
async function checkAzureSpeechHealth() {
    console.log('🏥 檢查 Azure Speech 服務健康狀態...');

    try {
        const region = process.env.AZURE_SPEECH_REGION;
        const key = process.env.AZURE_SPEECH_KEY;

        // 使用 REST API 測試服務可用性
        const response = await axios.get(
            `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': key
                },
                timeout: 15000
            }
        );

        console.log(`✅ Azure Speech 服務正常 (可用語音數: ${response.data.length})`);
        return true;
    } catch (error) {
        console.error('❌ Azure Speech 服務異常:', error.response?.status, error.message);

        if (error.response?.status === 401) {
            console.error('   認證失敗：請檢查 AZURE_SPEECH_KEY');
        } else if (error.response?.status === 403) {
            console.error('   權限不足：請檢查訂閱配額');
        }
        return false;
    }
}


// 文字轉語音
async function textToSpeech(text, targetLanguage = "zh", outputFileName = "output.wav") {

    let finalText = text;
    let languageToUse = targetLanguage;
    let timeout = 30000; // 預設超時時間 30 秒
    // Azure Speech SDK 支援的語言對應表
    const supportedSpeechLanguages = {
        'af': { lang: 'af-ZA', voice: 'af-ZA-AdriNeural' },
        'am': { lang: 'am-ET', voice: 'am-ET-MekdesNeural' },
        'ar': { lang: 'ar-SA', voice: 'ar-SA-ZariyahNeural' },
        'az': { lang: 'az-AZ', voice: 'az-AZ-BabekNeural' },
        'bg': { lang: 'bg-BG', voice: 'bg-BG-KalinaNeural' },
        'bn': { lang: 'bn-BD', voice: 'bn-BD-NabanitaNeural' },
        'bs': { lang: 'bs-BA', voice: 'bs-BA-VesnaNeural' },
        'ca': { lang: 'ca-ES', voice: 'ca-ES-JoanaNeural' },
        'cs': { lang: 'cs-CZ', voice: 'cs-CZ-VlastaNeural' },
        'cy': { lang: 'cy-GB', voice: 'cy-GB-NiaNeural' },
        'da': { lang: 'da-DK', voice: 'da-DK-ChristelNeural' },
        'de': { lang: 'de-DE', voice: 'de-DE-KatjaNeural' },
        'el': { lang: 'el-GR', voice: 'el-GR-AthinaNeural' },
        'en': { lang: 'en-US', voice: 'en-US-AriaNeural' },
        'es': { lang: 'es-ES', voice: 'es-ES-ElviraNeural' },
        'et': { lang: 'et-EE', voice: 'et-EE-AnuNeural' },
        'fa': { lang: 'fa-IR', voice: 'fa-IR-DilaraNeural' },
        'fi': { lang: 'fi-FI', voice: 'fi-FI-SelmaNeural' },
        'fr': { lang: 'fr-FR', voice: 'fr-FR-DeniseNeural' },
        'ga': { lang: 'ga-IE', voice: 'ga-IE-OrlaNeural' },
        'gl': { lang: 'gl-ES', voice: 'gl-ES-SabelaNeural' },
        'gu': { lang: 'gu-IN', voice: 'gu-IN-DhwaniNeural' },
        'he': { lang: 'he-IL', voice: 'he-IL-HilaNeural' },
        'hi': { lang: 'hi-IN', voice: 'hi-IN-SwaraNeural' },
        'hr': { lang: 'hr-HR', voice: 'hr-HR-GabrijelaNeural' },
        'hu': { lang: 'hu-HU', voice: 'hu-HU-NoemiNeural' },
        'hy': { lang: 'hy-AM', voice: 'hy-AM-AnahitNeural' },
        'id': { lang: 'id-ID', voice: 'id-ID-GadisNeural' },
        'is': { lang: 'is-IS', voice: 'is-IS-GudrunNeural' },
        'it': { lang: 'it-IT', voice: 'it-IT-ElsaNeural' },
        'ja': { lang: 'ja-JP', voice: 'ja-JP-NanamiNeural' },
        'jv': { lang: 'jv-ID', voice: 'jv-ID-SitiNeural' },
        'ka': { lang: 'ka-GE', voice: 'ka-GE-EkaNeural' },
        'kk': { lang: 'kk-KZ', voice: 'kk-KZ-AigulNeural' },
        'km': { lang: 'km-KH', voice: 'km-KH-SreymomNeural' },
        'kn': { lang: 'kn-IN', voice: 'kn-IN-SapnaNeural' },
        'ko': { lang: 'ko-KR', voice: 'ko-KR-SunHiNeural' },
        'lo': { lang: 'lo-LA', voice: 'lo-LA-KeomanyNeural' },
        'lt': { lang: 'lt-LT', voice: 'lt-LT-OnaNeural' },
        'lv': { lang: 'lv-LV', voice: 'lv-LV-EveritaNeural' },
        'mk': { lang: 'mk-MK', voice: 'mk-MK-MarijaNeural' },
        'ml': { lang: 'ml-IN', voice: 'ml-IN-SobhanaNeural' },
        'mn': { lang: 'mn-MN', voice: 'mn-MN-YesuiNeural' },
        'mr': { lang: 'mr-IN', voice: 'mr-IN-AarohiNeural' },
        'ms': { lang: 'ms-MY', voice: 'ms-MY-YasminNeural' },
        'mt': { lang: 'mt-MT', voice: 'mt-MT-GraceNeural' },
        'my': { lang: 'my-MM', voice: 'my-MM-NilarNeural' },
        'nb': { lang: 'nb-NO', voice: 'nb-NO-PernilleNeural' },
        'ne': { lang: 'ne-NP', voice: 'ne-NP-HemkalaNeural' },
        'nl': { lang: 'nl-NL', voice: 'nl-NL-ColetteNeural' },
        'pl': { lang: 'pl-PL', voice: 'pl-PL-ZofiaNeural' },
        'ps': { lang: 'ps-AF', voice: 'ps-AF-LatifaNeural' },
        'pt': { lang: 'pt-BR', voice: 'pt-BR-FranciscaNeural' },
        'ro': { lang: 'ro-RO', voice: 'ro-RO-AlinaNeural' },
        'ru': { lang: 'ru-RU', voice: 'ru-RU-SvetlanaNeural' },
        'si': { lang: 'si-LK', voice: 'si-LK-ThiliniNeural' },
        'sk': { lang: 'sk-SK', voice: 'sk-SK-ViktoriaNeural' },
        'sl': { lang: 'sl-SI', voice: 'sl-SI-PetraNeural' },
        'so': { lang: 'so-SO', voice: 'so-SO-UbaxNeural' },
        'sq': { lang: 'sq-AL', voice: 'sq-AL-AnilaNeural' },
        'sr': { lang: 'sr-RS', voice: 'sr-RS-SophieNeural' },
        'su': { lang: 'su-ID', voice: 'su-ID-TutiNeural' },
        'sv': { lang: 'sv-SE', voice: 'sv-SE-SofieNeural' },
        'sw': { lang: 'sw-KE', voice: 'sw-KE-ZuriNeural' },
        'ta': { lang: 'ta-IN', voice: 'ta-IN-PallaviNeural' },
        'te': { lang: 'te-IN', voice: 'te-IN-ShrutiNeural' },
        'th': { lang: 'th-TH', voice: 'th-TH-AcharaNeural' },
        'tr': { lang: 'tr-TR', voice: 'tr-TR-EmelNeural' },
        'uk': { lang: 'uk-UA', voice: 'uk-UA-PolinaNeural' },
        'ur': { lang: 'ur-PK', voice: 'ur-PK-UzmaNeural' },
        'uz': { lang: 'uz-UZ', voice: 'uz-UZ-MadinaNeural' },
        'vi': { lang: 'vi-VN', voice: 'vi-VN-HoaiMyNeural' },
        'zh': { lang: 'zh-CN', voice: 'zh-CN-XiaoxiaoNeural' },
        'zu': { lang: 'zu-ZA', voice: 'zu-ZA-ThandoNeural' }
    };

    // 檢查語言是否支援語音合成
    let isSpeechLanguageSupported = supportedSpeechLanguages.hasOwnProperty(languageToUse);
    if (!isSpeechLanguageSupported) {
        throw new Error(`不支援 '${languageToUse}' 語言的語音合成。`);
    }


    // 獲取語音配置
    const voiceConfig = supportedSpeechLanguages[languageToUse];
    console.log(`使用語音: ${voiceConfig.voice} (${voiceConfig.lang})`);


    try {
        console.log("🔊 開始文字轉語音...");
        console.log('=== Azure Speech 配置資訊 ===');
        console.log(`語音金鑰: ${process.env.AZURE_SPEECH_KEY.substring(0, 8)}...`);
        console.log(`服務區域: ${process.env.AZURE_SPEECH_REGION}`);
        console.log(`目標語言: ${voiceConfig.lang}`);
        console.log(`選用語音: ${voiceConfig.voice}`);
        console.log(`輸出檔案: ${outputFileName}`);
        console.log(`文字長度: ${finalText.length} 字符`);

        // 建立新的 Azure Speech 配置，避免與全局 speechConfig 衝突
        const speechServiceConfig = SpeechConfig.fromSubscription(
            process.env.AZURE_SPEECH_KEY,
            process.env.AZURE_SPEECH_REGION
        );

        // 設定語言與語音
        speechServiceConfig.speechSynthesisLanguage = voiceConfig.lang;
        speechServiceConfig.speechSynthesisVoiceName = voiceConfig.voice;

        // 4. 設定音頻格式（可能解決相容性問題）
        speechServiceConfig.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

        // 5. 啟用詳細日誌
        speechServiceConfig.enableAudioLogging = true;

        // 6. 建立音頻配置
        const audioConfig = AudioConfig.fromAudioFileOutput(outputFileName);

        // 7. 建立語音合成器
        const synthesizer = new SpeechSynthesizer(speechServiceConfig, audioConfig);

        // 8. 加入超時處理
        return new Promise((resolve, reject) => {
            // 設定超時計時器
            const timeoutId = setTimeout(() => {
                console.error(`語音合成超時 (${timeout}ms)`);
                synthesizer.close();
                reject(new Error(`語音合成超時，超過 ${timeout}ms`));
            }, timeout);

            // 監聽合成開始事件
            synthesizer.synthesisStarted = (s, e) => {
                console.log('🎵 語音合成開始...');
            };

            // 監聽合成進行中事件
            synthesizer.synthesizing = (s, e) => {
                console.log(`🔄 合成進度: ${e.result.audioDuration / 10000}ms`);
            };

            // 監聽取消事件
            synthesizer.SynthesisCanceled = (s, e) => {
                console.error('❌ 語音合成被取消:', e.reason);
                if (e.reason === CancellationReason.Error) {
                    console.error('錯誤詳情:', e.errorDetails);
                }
                clearTimeout(timeoutId);
                synthesizer.close();
                reject(new Error(`語音合成被取消: ${e.reason} - ${e.errorDetails}`));
            };

            // 執行語音合成
            synthesizer.speakTextAsync(
                finalText,
                result => {
                    clearTimeout(timeoutId);

                    console.log('=== 合成結果 ===');
                    console.log(`結果原因: ${result.reason}`);
                    console.log(`音頻長度: ${result.audioData ? result.audioData.byteLength : 0} bytes`);

                    if (result.reason === ResultReason.SynthesizingAudioCompleted) {
                        console.log(`✅ 語音合成成功，已保存到: ${outputFileName}`);
                        console.log(`🎵 音頻時長: ${result.audioDuration / 10000}ms`);

                        resolve({
                            success: true,
                            language: voiceConfig.lang,
                            text: finalText,
                            voice: voiceConfig.voice,
                            audioFile: outputFileName,
                            audioDuration: result.audioDuration,
                            audioDataSize: result.audioData.byteLength
                        });
                    } else {
                        console.error("❌ 語音合成失敗:");
                        console.error(`- 原因: ${result.reason}`);
                        console.error(`- 錯誤詳情: ${result.errorDetails}`);
                        console.error(`- 結果ID: ${result.resultId}`);

                        reject(new Error(`語音合成失敗: ${result.errorDetails || result.reason}`));
                    }
                    synthesizer.close();
                },
                error => {
                    clearTimeout(timeoutId);
                    console.error("❌ 語音合成發生錯誤:", error);
                    console.error("錯誤堆疊:", error.stack);
                    synthesizer.close();
                    reject(error);
                }
            );
        });


    } catch (error) {
        console.error("❌ 文字轉語音初始化失敗:", error);
        throw error;
    }
}


// 圖片分析端點
app.post("/api/analyzeimage", upload.single("image"), async (req, res) => {

    // Step 2: 網路連接測試
    console.log('2️⃣ 網路連接測試');
    await testNetworkConnectivity();
    console.log('');

    // Step 3: Azure 服務健康檢查
    console.log('3️⃣ Azure 服務健康檢查');
    const isHealthy = await checkAzureSpeechHealth();
    if (!isHealthy) {
        throw new Error('Azure Speech 服務不可用');
    }
    console.log('');

    return [];

    try {
        if (!req.file) {
            return res.status(400).json({ error: "請上傳圖片檔案" });
        }
        const imageBuffer = fs.readFileSync(req.file.path);



        console.log("📷 接收到圖片，開始分析...");


        // 1.圖片搜尋
        const searchResults = await searchAttractions(imageBuffer);


        // 2.OpenAI 整合
        const response = await generateResponse(searchResults);
        console.log("OpenAI 回應:", response);

        // 翻譯
        response.text = await translateResponse(response.text, "en");
        console.log("翻譯後的回應:", response.text);


        // 文字轉語音 - 建立音訊檔案目錄
        const audioDir = "./audio_output";
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }

        // 建立唯一的音訊檔案名稱
        const audioFileName = `${audioDir}/speech_${Date.now()}.wav`;

        try {
            const speechResult = await textToSpeech(response.text, "en", audioFileName);
            // response.audio = speechResult.audioFile.replace("./", "/"); // 轉換為相對URL路徑
            // console.log("語音合成完成:", response.audio);
        } catch (error) {
            console.error("語音合成錯誤:", error);
            response.audioError = error.message;
        }


        console.log('流程完成');


        // 返回分析結果給客戶端，包含智能回應
        return res.json({
            results: searchResults,
            response: response
        });

    } catch (error) {
        console.error("❌ 流程發生錯誤:", error);
        return res.status(500).json({ error: "流程發生錯誤" });
    }

});



// 啟動應用程式
startServer().catch(console.error);

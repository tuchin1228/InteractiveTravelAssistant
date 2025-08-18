// server.js - 互動式旅遊導覽 Agent Express 服務器
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
require("dotenv").config();
const { AzureKeyCredential } = require("@azure/core-auth");

// Azure AI Translator SDK
const TextTranslationClient =
    require("@azure-rest/ai-translation-text").default;

// Azure AI Speech SDK
const {
    SpeechConfig,
    AudioConfig,
    SpeechRecognizer,
    SpeechSynthesizer,
    ResultReason,
    CancellationReason,
    SpeechSynthesisOutputFormat
} = require("microsoft-cognitiveservices-speech-sdk");

// Azure AI Search SDK
const { SearchClient } = require("@azure/search-documents");

// Azure OpenAI
const { AzureOpenAI } = require("openai");

// Azure Blob Storage SDK
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件設定
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));


// 檔案上傳設定 - 使用記憶體存儲
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });



// 全域服務客戶端
let visionClient, speechConfig, translationClient, searchClient, GPTClient;

// 🚀 初始化 Azure AI 服務
function initializeAzureServices() {
    try {
        // Search 服務
        searchClient = new SearchClient(
            process.env.AZURE_SEARCH_ENDPOINT,
            process.env.AZURE_SEARCH_INDEX,
            new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
        );

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


        // 使用標準的 API 金鑰驗證
        GPTClient = new AzureOpenAI({
            apiKey: process.env.AZURE_OPENAI_KEY,
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            deployment: "gpt-4o",
            apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2023-05-15"
        });



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


// 取得翻譯語言列表
app.get("/api/languages", async (req, res) => {
    try {
        const translateList = await translationClient.path("/languages").get();
        // #response
        // {
        //     "translation": {
        //     "af": {
        //         "name": "Afrikaans",
        //         "nativeName": "Afrikaans",
        //         "dir": "ltr"
        //     },
        //     "am": {
        //         "name": "Amharic",
        //         "nativeName": "አማርኛ",
        //         "dir": "ltr"
        //     }
        // ...}
        // console.log('取得翻譯語言列表:', translateList.body);

        res.json(translateList.body);
    } catch (error) {
        console.error("❌ 取得翻譯語言列表失敗:", error);
        res.status(500).json({ error: "無法取得翻譯語言列表" });
    }
});


// 分析圖片景點
async function imageAnalyze(imageBuffer) {
    try {
        // 呼叫 Azure 內容理解服務進行圖片分析
        const analyzeUrl = `${process.env.AZURE_AI_CONTENT_UNDERSTANDING_ENDPOINT}/contentunderstanding/analyzers/${process.env.AZURE_AI_CONTENT_UNDERSTANDING_ANALYTIZERID}:analyze?api-version=${process.env.AZURE_AI_CONTENT_UNDERSTANDING_API_VERSION}&stringEncoding=utf16`;
        const postResponse = await axios.post(analyzeUrl, imageBuffer, {
            headers: {
                "Ocp-Apim-Subscription-Key": process.env.AZURE_AI_CONTENT_UNDERSTANDING_KEY,
                "Content-Type": "application/octet-stream"
            }
        });

        // 取得 operation-location，開始輪詢
        const operationLocation = postResponse.headers["operation-location"];
        if (!operationLocation) {
            throw new Error("未從回應取得 operation-location");
        }

        // 輪詢直到完成
        let result;
        while (true) {
            const poll = await axios.get(operationLocation, {
                headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_AI_CONTENT_UNDERSTANDING_KEY }
            });
            result = poll.data;
            const status = result.status?.toLowerCase();
            if (status === "succeeded") break;
            if (status === "failed") {
                throw new Error(`分析失敗: ${JSON.stringify(result)}`);
            }
            console.log(`分析進行中…狀態：${status}`);
            await new Promise((r) => setTimeout(r, 2000));
        }

        // 只回傳 AttractionName.valueString
        const attractionName = result?.result?.contents?.[0]?.fields?.AttractionName?.valueString || null;
        console.log('分析結果:', attractionName);

        return attractionName;

    } catch (error) {
        console.error("❌ 圖片分析失敗:", error);
        throw error;
    }
}


// 🔍 搜尋景點函數
async function searchAttractions(searchText) {
    try {
        console.log("🔍 搜尋相關景點");



        const options = {
            top: 3,                          // 最多回傳 3 筆結果
            select: ["title", "chunk"],      // 只取部分欄位
            queryType: "semantic",           // 啟用語意搜尋
            semanticConfiguration: "default", // 使用預設語意配置
            queryLanguage: "zh-tw",          // 查詢語言設置為繁體中文
            captions: "extractive",          // 返回摘要
            answers: "extractive",           // 返回答案
            semanticFields: ["chunk", "title"] // 指定用於語意排名的欄位
        };

        const SearchResults = await searchClient.search(searchText, options);


        console.log("=== 最高分搜尋結果 ===");
        let topResult = null;
        let topScore = -1;

        for await (const { document, score } of SearchResults.results) {
            if (score > topScore) {
                topScore = score;
                topResult = document;
            }
        }

        if (topResult) {
            console.log(`Score: ${topScore.toFixed(2)}`);
        } else {
            console.log("沒有找到任何結果");
        }

        const results = topResult

        // 檢查第一筆搜尋結果的分數
        if (topScore.toFixed(2) < 2) {
            console.log("⚠️ 搜尋結果分數過低，視為未找到匹配結果");
            return [];
        }

        // 分數足夠高，返回結果
        return [results];

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

        const events = await GPTClient.chat.completions.create({
            messages: [
                { role: "system", content: "你是一個資深導遊，擅長提供旅遊建議和景點資訊。" },
                {
                    role: "user", content: ` ${searchResults[0]?.chunk}。
                根據以上資料，生成結果為一段文字敘述，內容必須包含:
                1.景點名稱(name)
                2.景點歷史(history)
                3.景點描述(description)
                4.景點開放時間(opening_hours)
                並確保文字敘述流暢、通順。
                最後務必加上 ([圖片來源]:(imageSource))` },
            ],
            model: "gpt-4o"
        });
        const response = events.choices[0].message.content;
        console.log("🤖 回應生成成功");

        // 返回生成的回應
        return {
            type: "success",
            text: response,
            source: {
                title: searchResults[0]?.title || "未知景點",
                content: searchResults[0]?.chunk || ""
            }
        };

    } catch (error) {
        console.error("❌ 回應生成失敗:", error);
        throw error;
    }
}


// 翻譯 OpenAI 回應
async function translateResponse(responseText, originalContent, targetLanguage = "zh-Hant") {
    try {
        console.log("🌐 開始翻譯回應...:", responseText);
        console.log('來源語言:', originalContent);
        console.log(`目標語言: ${targetLanguage}`);

        // 標準化語言代碼
        // 處理特殊情況：如果目標語言是簡體中文或繁體中文的特殊代碼
        let translationTargetLanguage = targetLanguage;

        const inputText = [{ text: responseText }];
        const parameters = {
            to: translationTargetLanguage,
            from: originalContent ?? "zh-Hant", // 因為 GPT 的 Prompt 是中文撰寫，所以回應語言預設為中文
        };

        const translateResponse = await translationClient.path("/translate").post({
            body: inputText,
            queryParameters: parameters,
        });

        const translatedText = translateResponse?.body[0]?.translations[0]?.text;
        console.log(`🌐 翻譯完成 (${translatedText})`);
        return translatedText;

    } catch (error) {
        console.error("❌ 翻譯失敗:", error);
        console.error("錯誤詳情:", error.message);
        return responseText;
    }
}


// 文字轉語音 - 直接返回語音數據，不儲存檔案
async function textToSpeech(text, targetLanguage = "zh-TW") {

    let finalText = text;
    let timeout = 30000; // 預設超時時間 30 秒

    // 建立從 Translation API 語言代碼到 Speech API 語言代碼的映射
    // Translation API 使用的是 ISO 639 語言代碼，而 Speech API 使用的是 BCP-47 標準
    const translationToSpeechLangMap = {
        // 特殊處理的語言映射 (需特別注意的差異)
        'zh-Hans': 'zh-CN',
        'zh-Hant': 'zh-TW',
    };

    // 獲取映射後的語言代碼 - 僅處理特定語言轉換
    let languageToUse = targetLanguage;
    // 只針對簡體中文和繁體中文進行特殊映射
    if (targetLanguage == 'zh-Hans' || targetLanguage == 'zh-Hant') {
        languageToUse = translationToSpeechLangMap[targetLanguage];
    }

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
        'en-GB': { lang: 'en-GB', voice: 'en-GB-SoniaNeural' },
        'en-US': { lang: 'en-US', voice: 'en-US-AriaNeural' },
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
        'zh-CN': { lang: 'zh-CN', voice: 'zh-CN-XiaoxiaoNeural' },
        'zh-TW': { lang: 'zh-TW', voice: 'zh-TW-HsiaoChenNeural' },
        'zu': { lang: 'zu-ZA', voice: 'zu-ZA-ThandoNeural' }
    };



    // 檢查語言是否支援語音合成
    let isSpeechLanguageSupported = supportedSpeechLanguages.hasOwnProperty(languageToUse);
    if (!isSpeechLanguageSupported) {
        console.warn(`警告：不支援 '${languageToUse}' 語言的語音合成，嘗試使用基礎語言碼...`);
        // 嘗試只使用基本語言碼 (例如從 'zh-Hant' 轉為 'zh')
        const baseLanguageCode = languageToUse.split('-')[0];
        if (supportedSpeechLanguages.hasOwnProperty(baseLanguageCode)) {
            console.log(`使用基礎語言代碼 '${baseLanguageCode}' 代替 '${languageToUse}'`);
            languageToUse = baseLanguageCode;
        } else {
            throw new Error(`不支援 '${languageToUse}' 或其基礎語言 '${baseLanguageCode}' 的語音合成。`);
        }
    }


    // 獲取語音配置
    const voiceConfig = supportedSpeechLanguages[languageToUse];
    console.log(`使用語音: ${voiceConfig.voice} (${voiceConfig.lang})`);


    try {

        // 設定語言與語音
        speechConfig.speechSynthesisLanguage = voiceConfig.lang;
        speechConfig.speechSynthesisVoiceName = voiceConfig.voice;

        // 4. 設定音頻格式（可能解決相容性問題）
        speechConfig.speechSynthesisOutputFormat = SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

        // 5. 啟用詳細日誌
        speechConfig.enableAudioLogging = true;

        // 6. 建立語音合成器 - 不指定音頻配置，讓語音數據保存在結果中
        const synthesizer = new SpeechSynthesizer(speechConfig);

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


            // 執行語音合成
            synthesizer.speakTextAsync(
                finalText,
                result => {
                    clearTimeout(timeoutId);

                    console.log('=== 合成結果 ===');

                    if (result.reason === ResultReason.SynthesizingAudioCompleted) {
                        console.log(`✅ 語音合成成功`);
                        console.log(`🎵 音頻時長: ${result.audioDuration / 10000}ms`);

                        // 將音頻二進制數據轉換為 Base64 字串，方便傳輸
                        const audioData = Buffer.from(result.audioData);
                        const audioBase64 = audioData.toString('base64');

                        resolve({
                            success: true,
                            language: voiceConfig.lang,
                            text: finalText,
                            voice: voiceConfig.voice,
                            audioContent: audioBase64, // 直接返回 Base64 編碼的音頻數據
                            audioDuration: result.audioDuration,
                            audioDataSize: result.audioData.byteLength,
                            contentType: "audio/mp3" // 設定為 MP3 格式
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

// 獲取景點圖片
async function GetStorageMetadata(searchResults) {
    if (!searchResults || searchResults.length === 0) {
        console.warn("⚠️ 無法獲取存儲Metadata，因為沒有搜尋結果");
        return null;
    }
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient("attractions");
    const blobClient = containerClient.getBlobClient(searchResults[0].title);

    const properties = await blobClient.getProperties();
    console.log("Linked file metadata:", properties?.metadata?.imgurl);  // 會印出 target.pdf 或 URL

    return properties?.metadata?.imgurl || null;
}



// 圖片分析與資料彙整 API
app.post("/api/analyzeimage", upload.single("image"), async (req, res) => {


    try {
        if (!req.file) {
            return res.status(400).json({ error: "請上傳圖片檔案" });
        }
        const imageBuffer = req.file.buffer;

        // 獲取用戶選擇的語言
        const language = req.body.language || "zh";

        console.log(`📷 接收到圖片，開始分析... 選擇語言: ${language}`);


        // 1.呼叫 Azure AI Content Understanding 分析
        const AnalyzeResults = await imageAnalyze(imageBuffer);

        // 2.景點相關介紹搜尋
        const searchResults = await searchAttractions(AnalyzeResults);


        // 3.OpenAI 整合
        const response = await generateResponse(searchResults);

        // 4.翻譯到用戶選擇的語言
        response.text = await translateResponse(response.text, null, language);
        console.log(`翻譯後的回應 (${language}):`, response.text);

        // 儲存選擇的語言
        response.language = language;


        // 5.文字轉語音 - 直接在記憶體中處理並回傳
        try {
            const speechResult = await textToSpeech(response.text, language);
            // 將音頻資料添加到回應中
            response.audio = {
                content: speechResult.audioContent,
                contentType: speechResult.contentType,
                duration: speechResult.audioDuration,
                size: speechResult.audioDataSize
            };
            console.log("語音合成完成，音頻數據已添加到回應中");
        } catch (error) {
            console.error("語音合成錯誤:", error);
            response.audioError = error.message;
        }

        // 6.獲取圖片存儲的 URL
        const imgurl = await GetStorageMetadata(searchResults);


        console.log('流程完成');


        // 返回分析結果給客戶端，包含智能回應
        return res.json({
            results: searchResults,
            response: response,
            imgurl: imgurl
        });

    } catch (error) {
        console.error("❌ 流程發生錯誤:", error);
        return res.status(500).json({ error: "流程發生錯誤" });
    }

});



// 切換語言時重新產生語音語翻譯 API
app.post("/api/translate", express.json(), async (req, res) => {
    try {
        const { text, language, originalContent } = req.body;

        if (!text) {
            return res.status(400).json({ error: "缺少文字內容" });
        }

        console.log(`🌐 開始翻譯到 ${language}...`);

        // 翻譯舊的內容
        let translatedText = await translateResponse(text, originalContent, language);

        // 生成語音
        const speechResult = await textToSpeech(translatedText, language);

        // 返回結果
        return res.json({
            text: translatedText,
            language: language,
            audio: {
                content: speechResult.audioContent,
                contentType: speechResult.contentType,
                duration: speechResult.audioDuration,
                size: speechResult.audioDataSize
            }
        });

    } catch (error) {
        console.error("❌ 翻譯或語音合成失敗:", error);
        return res.status(500).json({ error: "翻譯或語音合成失敗" });
    }
});


// 啟動應用程式
startServer().catch(console.error);

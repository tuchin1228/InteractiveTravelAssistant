# 互動式旅遊導覽助手

本專案是一個互動式旅遊導覽應用，用戶可以上傳景點照片，系統會識別景點並提供詳細資訊與語音導覽。

## 功能特色

- **景點識別**：上傳照片自動識別景點
- **多語言支援**：支援中文、英文、日文、韓文等多種語言
- **文字說明**：提供景點名稱、歷史、描述、開放時間等詳細資訊
- **語音導覽**：自動生成語音解說，讓用戶聆聽景點介紹
- **即時翻譯**：可即時切換不同語言的文字與語音導覽

## 技術架構

### 前端 (public/index.html)
- 純HTML/CSS/JavaScript實現
- Bootstrap 5 UI框架
- 響應式設計，支援桌面與移動裝置

### 後端 (server.js)
- Node.js + Express 框架
- RESTful API架構

### Azure AI 整合
- **Azure AI Search**：圖像檢索與相似性比對
- **Azure OpenAI**：智能文本生成（gpt-4o）
- **Azure AI Translation**：多語言翻譯
- **Azure AI Speech**：語音合成
- **Azure Blob Storage**：多媒體內容儲存

## 操作流程

1. **選擇語言**：用戶先選擇想要獲取資訊的語言
2. **上傳照片**：點擊上傳區域或拖曳照片至頁面
3. **自動分析**：上傳完成後自動進行景點辨識和分析
4. **查看結果**：顯示景點資訊與預覽圖片
5. **收聽導覽**：點擊播放按鈕收聽語音導覽
6. **語言切換**：可隨時更換語言並重新生成導覽內容

## API 端點

- **/api/analyzeimage**：接收上傳的圖片，返回景點資訊、文本說明和語音導覽
- **/api/translate**：將文本翻譯成指定語言並生成對應語音
- **/api/languages**：取得支援的翻譯語言列表

## 安裝與設定

### 系統需求
- Node.js v16+
- npm 或 yarn

### 安裝步驟

1. 複製專案
```
git clone https://github.com/tuchin1228/AzureSDKIntegrate.git
cd AzureSDKIntegrate
```

2. 安裝相依套件
```
npm install
```

3. 配置環境變數
將 `.env.sample` 複製為 `.env` 並填入以下 Azure 服務密鑰：

```
# Azure Speech 服務
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=your_speech_region

# Azure Translation 服務
AZURE_TRANSLATION_KEY=your_translation_key
AZURE_TRANSLATION_ENDPOINT=https://api.cognitive.microsofttranslator.com/

# Azure AI Search
AZURE_SEARCH_KEY=your_search_key
AZURE_SEARCH_ENDPOINT=your_search_endpoint
AZURE_SEARCH_INDEX=your_search_index_name

# Azure OpenAI
AZURE_OPENAI_KEY=your_openai_key
AZURE_OPENAI_ENDPOINT=your_openai_endpoint
AZURE_OPENAI_API_VERSION=2023-05-15

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING=your_storage_connection_string
```

4. 啟動服務
```
npm run dev
```

5. 訪問應用
打開瀏覽器，訪問 http://localhost:3000

## 程式邏輯流程

1. 用戶上傳照片，選擇語言
2. 後端接收請求，提取圖像和語言參數
3. 使用Azure AI Search進行圖像搜索，找出相似景點
4. 使用Azure OpenAI (gpt-4o) 生成景點的詳細介紹
5. 使用Azure AI Translation將文本翻譯成用戶選擇的語言
6. 使用Azure AI Speech將文本轉換為語音
7. 從Azure Blob Storage取得景點高清圖片URL (如有)
8. 將所有結果打包並回傳給前端
9. 前端展示文本說明和圖片，並提供語音播放功能




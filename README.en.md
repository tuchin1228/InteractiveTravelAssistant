<div align="center">

# Interactive Travel Guide Assistant
[[繁體中文]](readme.md)

This project is an interactive travel guide application where users can upload photos of tourist attractions, and the system will identify the location and provide detailed information with audio guidance.

</div>

## Features

- **Landmark Recognition**: Automatically identify landmarks from uploaded photos
- **Multilingual Support**: Supports multiple languages including English, Chinese, Japanese, Korean
- **Text Description**: Provides detailed information including landmark name, history, description, opening hours
- **Audio Guide**: Automatically generates audio narration for listening to attraction introductions
- **Real-time Translation**: Switch between different languages for text and audio guides instantly

## Technical Architecture

### Frontend (public/index.html)
- Pure HTML/CSS/JavaScript implementation
- Bootstrap 5 UI framework
- Responsive design, supporting desktop and mobile devices

### Backend (server.js)
- Node.js + Express framework
- RESTful API architecture

### Azure AI Integration
- **Azure AI Search**: Image retrieval and similarity matching
- **Azure OpenAI**: Intelligent text generation (gpt-4o)
- **Azure AI Translation**: Multilingual translation
- **Azure AI Speech**: Speech synthesis
- **Azure Blob Storage**: Multimedia content storage

## Operation Flow

1. **Language Selection**: User selects the desired information language
2. **Photo Upload**: Click upload area or drag & drop photo to the page
3. **Automatic Analysis**: Automatically performs landmark recognition and analysis after upload
4. **View Results**: Display landmark information and preview images
5. **Listen to Guide**: Click play button to listen to audio guide (Note: Some languages may not support Azure Speech service)
6. **Language Switch**: Switch languages and regenerate guide content anytime

## API Endpoints

- **/api/analyzeimage**: Receives uploaded images, returns landmark information, text description and audio guide
- **/api/translate**: Translates text to specified language and generates corresponding audio
- **/api/languages**: Get list of supported translation languages

## Installation & Setup

### System Requirements
- Node.js v16+
- npm or yarn

### Installation Steps

1. Clone Project
```
git clone https://github.com/tuchin1228/AzureSDKIntegrate.git
cd AzureSDKIntegrate
```

2. Install Dependencies
```
npm install
```

3. Configure Environment Variables
Copy `.env.sample` to `.env` and fill in the following Azure service keys:

```
# Azure Speech Service
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=your_speech_region

# Azure Translation Service
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

4. Start Service
```
npm run dev
```

5. Access Application
Open browser and visit http://localhost:3000

## Program Logic Flow

1. User uploads photo and selects language
2. Backend receives request, extracts image and language parameters
3. Use Azure AI Search to perform image search and find similar landmarks
4. Use Azure OpenAI (gpt-4o) to generate detailed landmark descriptions
5. Use Azure AI Translation to translate text into user's chosen language
6. Use Azure AI Speech to convert text to speech
7. Get high-resolution image URL from Azure Blob Storage
8. Package all results and return to frontend
9. Frontend displays text description and images, provides audio playback functionality

## Data Preprocessing Flow

1. Upload landmark images and descriptions to Azure Blob Storage
2. Process images and text data through Azure AI Search for vectorization
3. Azure AI Search uses multimodal vector index
4. Create vectorized index to support image similarity search and text semantic search

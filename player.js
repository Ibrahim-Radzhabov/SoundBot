/**
 * Telegram Mini App - Music Player
 * Полнофункциональный музыкальный плеер для Telegram
 */

// ===== Global State =====
const AppState = {
    currentTrack: null,
    currentPlaylist: [],
    currentPlaylistIndex: 0,
    playlists: [],
    isPlaying: false,
    isShuffled: false,
    repeatMode: 'off', // 'off', 'one', 'all'
    volume: 70,
    currentTime: 0,
    duration: 0,
    searchResults: [],
    currentSearchType: 'local',
    theme: 'auto'
};

// ===== Telegram WebApp Integration =====
let tg = null;

function initTelegramWebApp() {
    if (window.Telegram && window.Telegram.WebApp) {
        tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        // Настройка темы
        if (tg.colorScheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }

        // Слушаем изменения темы
        tg.onEvent('themeChanged', () => {
            if (AppState.theme === 'auto') {
                document.documentElement.setAttribute('data-theme', tg.colorScheme);
            }
        });

        // Включаем вибрацию для тактильной обратной связи
        tg.enableClosingConfirmation();

        console.log('Telegram WebApp initialized');
    } else {
        console.warn('Telegram WebApp not available, running in browser mode');
    }
}

// ===== Audio Player =====
class AudioPlayer {
    constructor() {
        this.audio = new Audio();
        this.setupAudioListeners();
    }

    setupAudioListeners() {
        this.audio.addEventListener('loadedmetadata', () => {
            AppState.duration = this.audio.duration;
            updateDurationDisplay();
        });

        this.audio.addEventListener('timeupdate', () => {
            AppState.currentTime = this.audio.currentTime;
            updateProgressBar();
        });

        this.audio.addEventListener('ended', () => {
            handleTrackEnd();
        });

        this.audio.addEventListener('error', (e) => {
            showToast('Ошибка воспроизведения трека', 'error');
            console.error('Audio error:', e);
        });

        this.audio.addEventListener('play', () => {
            AppState.isPlaying = true;
            updatePlayPauseButton();
        });

        this.audio.addEventListener('pause', () => {
            AppState.isPlaying = false;
            updatePlayPauseButton();
        });
    }

    loadTrack(track) {
        if (!track || !track.url) {
            showToast('Трек не найден', 'error');
            return;
        }

        this.audio.src = track.url;
        this.audio.load();
        AppState.currentTrack = track;
        updateTrackInfo();

        // Уведомление в Telegram
        if (tg) {
            tg.showNotification(`🎵 ${track.title} - ${track.artist}`);
        }
    }

    play() {
        this.audio.play().catch(e => {
            console.error('Play error:', e);
            showToast('Не удалось воспроизвести трек', 'error');
        });
    }

    pause() {
        this.audio.pause();
    }

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
    }

    setVolume(volume) {
        this.audio.volume = volume / 100;
        AppState.volume = volume;
    }

    seek(time) {
        this.audio.currentTime = time;
    }
}

const audioPlayer = new AudioPlayer();

// ===== Storage Manager =====
class StorageManager {
    constructor() {
        this.storageKey = 'musicPlayerData';
        this.init();
    }

    init() {
        this.loadData();
    }

    saveData() {
        try {
            const data = {
                playlists: AppState.playlists,
                volume: AppState.volume,
                theme: AppState.theme,
                repeatMode: AppState.repeatMode,
                isShuffled: AppState.isShuffled
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) {
            console.error('Error saving data:', e);
            showToast('Ошибка сохранения данных', 'error');
        }
    }

    loadData() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                AppState.playlists = parsed.playlists || [];
                AppState.volume = parsed.volume || 70;
                AppState.theme = parsed.theme || 'auto';
                AppState.repeatMode = parsed.repeatMode || 'off';
                AppState.isShuffled = parsed.isShuffled || false;

                audioPlayer.setVolume(AppState.volume);
                updateVolumeDisplay();
                updateTheme();
                updateShuffleButton();
                updateRepeatButton();
            }
        } catch (e) {
            console.error('Error loading data:', e);
        }
    }

    clearAllData() {
        if (confirm('Вы уверены, что хотите удалить все данные?')) {
            localStorage.removeItem(this.storageKey);
            AppState.playlists = [];
            AppState.currentPlaylist = [];
            AppState.currentTrack = null;
            audioPlayer.stop();
            renderPlaylists();
            showToast('Все данные удалены', 'success');
        }
    }
}

const storageManager = new StorageManager();

// ===== Playlist Manager =====
class PlaylistManager {
    createPlaylist(name) {
        const playlist = {
            id: Date.now().toString(),
            name: name || `Плейлист ${AppState.playlists.length + 1}`,
            tracks: [],
            createdAt: new Date().toISOString()
        };
        AppState.playlists.push(playlist);
        storageManager.saveData();
        return playlist;
    }

    deletePlaylist(playlistId) {
        AppState.playlists = AppState.playlists.filter(p => p.id !== playlistId);
        storageManager.saveData();
    }

    addTrackToPlaylist(playlistId, track) {
        const playlist = AppState.playlists.find(p => p.id === playlistId);
        if (playlist) {
            playlist.tracks.push(track);
            storageManager.saveData();
            return true;
        }
        return false;
    }

    removeTrackFromPlaylist(playlistId, trackIndex) {
        const playlist = AppState.playlists.find(p => p.id === playlistId);
        if (playlist && playlist.tracks[trackIndex]) {
            playlist.tracks.splice(trackIndex, 1);
            storageManager.saveData();
            return true;
        }
        return false;
    }

    getPlaylist(playlistId) {
        return AppState.playlists.find(p => p.id === playlistId);
    }
}

const playlistManager = new PlaylistManager();

// ===== Search Engine =====
class SearchEngine {
    async searchLocal(query) {
        // Поиск в локальных плейлистах
        const results = [];
        AppState.playlists.forEach(playlist => {
            playlist.tracks.forEach(track => {
                const searchText = `${track.title} ${track.artist}`.toLowerCase();
                if (searchText.includes(query.toLowerCase())) {
                    results.push({
                        ...track,
                        playlistId: playlist.id,
                        playlistName: playlist.name
                    });
                }
            });
        });
        return results;
    }

    async searchYouTube(query) {
        // Заглушка для YouTube поиска
        // В реальном приложении здесь будет интеграция с YouTube API
        showToast('YouTube поиск в разработке', 'info');
        return [];
    }

    async searchByURL(url) {
        // Попытка извлечь аудио из URL
        // Поддержка различных форматов
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            // Здесь нужна интеграция с YouTube API для извлечения аудио
            showToast('YouTube URL в разработке', 'info');
            return null;
        }

        // Прямая ссылка на аудио файл
        if (url.match(/\.(mp3|wav|flac|ogg|m4a)$/i)) {
            return {
                id: Date.now().toString(),
                title: url.split('/').pop().replace(/\.(mp3|wav|flac|ogg|m4a)$/i, ''),
                artist: 'Неизвестный исполнитель',
                url: url,
                duration: 0,
                cover: null
            };
        }

        showToast('Неподдерживаемый формат URL', 'error');
        return null;
    }
}

const searchEngine = new SearchEngine();

// ===== File Upload Handler =====
function handleFileUpload(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('audio/')) {
            reject(new Error('Файл не является аудио'));
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const track = {
                id: Date.now().toString(),
                title: file.name.replace(/\.[^/.]+$/, ''),
                artist: 'Неизвестный исполнитель',
                url: e.target.result,
                duration: 0,
                cover: null,
                file: file.name
            };

            // Попытка получить метаданные
            const audio = new Audio();
            audio.src = e.target.result;
            audio.addEventListener('loadedmetadata', () => {
                track.duration = audio.duration;
            });

            resolve(track);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ===== UI Update Functions =====
function updateTrackInfo() {
    const track = AppState.currentTrack;
    if (!track) return;

    document.getElementById('track-title').textContent = track.title || 'Без названия';
    document.getElementById('track-artist').textContent = track.artist || 'Неизвестный исполнитель';

    if (track.cover) {
        document.getElementById('album-art').src = track.cover;
    }
}

function updatePlayPauseButton() {
    const btn = document.getElementById('play-pause-btn');
    if (AppState.isPlaying) {
        btn.textContent = '⏸';
        btn.title = 'Пауза';
    } else {
        btn.textContent = '▶️';
        btn.title = 'Воспроизвести';
    }
}

function updateProgressBar() {
    const slider = document.getElementById('progress-slider');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');

    if (AppState.duration > 0) {
        const progress = (AppState.currentTime / AppState.duration) * 100;
        slider.value = progress;
    }

    currentTimeEl.textContent = formatTime(AppState.currentTime);
    totalTimeEl.textContent = formatTime(AppState.duration);
}

function updateDurationDisplay() {
    document.getElementById('total-time').textContent = formatTime(AppState.duration);
}

function updateVolumeDisplay() {
    const slider = document.getElementById('volume-slider');
    const valueEl = document.getElementById('volume-value');
    slider.value = AppState.volume;
    valueEl.textContent = `${AppState.volume}%`;
}

function updateShuffleButton() {
    const btn = document.getElementById('shuffle-btn');
    if (AppState.isShuffled) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

function updateRepeatButton() {
    const btn = document.getElementById('repeat-btn');
    const modes = {
        'off': '🔁',
        'one': '🔂',
        'all': '🔁'
    };
    btn.textContent = modes[AppState.repeatMode];
    btn.title = AppState.repeatMode === 'off' ? 'Повтор выключен' :
                AppState.repeatMode === 'one' ? 'Повтор трека' : 'Повтор плейлиста';
}

function updateTheme() {
    const select = document.getElementById('theme-select');
    select.value = AppState.theme;

    if (AppState.theme === 'auto' && tg) {
        document.documentElement.setAttribute('data-theme', tg.colorScheme);
    } else {
        document.documentElement.setAttribute('data-theme', AppState.theme);
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== Playback Control Functions =====
function playPause() {
    if (!AppState.currentTrack) {
        if (AppState.currentPlaylist.length > 0) {
            playTrack(0);
        } else {
            showToast('Нет треков для воспроизведения', 'error');
        }
        return;
    }

    if (AppState.isPlaying) {
        audioPlayer.pause();
    } else {
        audioPlayer.play();
    }
}

function playTrack(index) {
    if (index < 0 || index >= AppState.currentPlaylist.length) return;

    AppState.currentPlaylistIndex = index;
    const track = AppState.currentPlaylist[index];
    audioPlayer.loadTrack(track);
    audioPlayer.play();
    renderCurrentPlaylist();
}

function playNext() {
    if (AppState.currentPlaylist.length === 0) return;

    let nextIndex;
    if (AppState.isShuffled) {
        nextIndex = Math.floor(Math.random() * AppState.currentPlaylist.length);
    } else {
        nextIndex = (AppState.currentPlaylistIndex + 1) % AppState.currentPlaylist.length;
    }

    playTrack(nextIndex);
}

function playPrevious() {
    if (AppState.currentPlaylist.length === 0) return;

    let prevIndex;
    if (AppState.currentPlaylistIndex > 0) {
        prevIndex = AppState.currentPlaylistIndex - 1;
    } else {
        prevIndex = AppState.currentPlaylist.length - 1;
    }

    playTrack(prevIndex);
}

function handleTrackEnd() {
    if (AppState.repeatMode === 'one') {
        audioPlayer.seek(0);
        audioPlayer.play();
    } else if (AppState.repeatMode === 'all' || AppState.currentPlaylistIndex < AppState.currentPlaylist.length - 1) {
        playNext();
    } else {
        AppState.isPlaying = false;
        updatePlayPauseButton();
    }
}

function toggleShuffle() {
    AppState.isShuffled = !AppState.isShuffled;
    updateShuffleButton();
    storageManager.saveData();
    showToast(AppState.isShuffled ? 'Перемешивание включено' : 'Перемешивание выключено', 'info');
}

function toggleRepeat() {
    const modes = ['off', 'one', 'all'];
    const currentIndex = modes.indexOf(AppState.repeatMode);
    AppState.repeatMode = modes[(currentIndex + 1) % modes.length];
    updateRepeatButton();
    storageManager.saveData();
}

// ===== Rendering Functions =====
function renderCurrentPlaylist() {
    const container = document.getElementById('current-playlist');
    container.innerHTML = '';

    AppState.currentPlaylist.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = `track-item ${index === AppState.currentPlaylistIndex ? 'active' : ''}`;
        item.innerHTML = `
            <div class="track-item-info">
                <div class="track-item-title">${track.title || 'Без названия'}</div>
                <div class="track-item-artist">${track.artist || 'Неизвестный исполнитель'}</div>
            </div>
            <div class="track-item-duration">${formatTime(track.duration)}</div>
        `;
        item.addEventListener('click', () => playTrack(index));
        container.appendChild(item);
    });
}

function renderPlaylists() {
    const container = document.getElementById('playlists-list');
    container.innerHTML = '';

    if (AppState.playlists.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--tg-theme-hint-color); padding: 20px;">Нет плейлистов. Создайте первый плейлист!</p>';
        return;
    }

    AppState.playlists.forEach(playlist => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
            <div class="playlist-card-header">
                <div class="playlist-card-name">${playlist.name}</div>
                <div class="playlist-card-count">${playlist.tracks.length} треков</div>
            </div>
        `;
        card.addEventListener('click', () => openPlaylistModal(playlist.id));
        container.appendChild(card);
    });
}

function renderSearchResults(results) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (results.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--tg-theme-hint-color); padding: 20px;">Ничего не найдено</p>';
        return;
    }

    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `
            <div class="result-item-icon">🎵</div>
            <div class="result-item-info">
                <div class="result-item-title">${result.title || 'Без названия'}</div>
                <div class="result-item-meta">${result.artist || 'Неизвестный исполнитель'}</div>
            </div>
            <button class="result-item-action" data-action="add">➕</button>
        `;

        const addBtn = item.querySelector('[data-action="add"]');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addTrackToCurrentPlaylist(result);
        });

        item.addEventListener('click', () => {
            addTrackToCurrentPlaylist(result);
            playTrack(AppState.currentPlaylist.length - 1);
        });

        container.appendChild(item);
    });
}

function addTrackToCurrentPlaylist(track) {
    AppState.currentPlaylist.push(track);
    renderCurrentPlaylist();
    showToast('Трек добавлен в плейлист', 'success');
}

// ===== Modal Functions =====
function openPlaylistModal(playlistId) {
    const modal = document.getElementById('playlist-modal');
    const playlist = playlistManager.getPlaylist(playlistId);

    if (!playlist) {
        // Создание нового плейлиста
        document.getElementById('playlist-modal-title').textContent = 'Новый плейлист';
        document.getElementById('playlist-name-input').value = '';
        document.getElementById('delete-playlist-btn').style.display = 'none';
    } else {
        document.getElementById('playlist-modal-title').textContent = playlist.name;
        document.getElementById('playlist-name-input').value = playlist.name;
        document.getElementById('delete-playlist-btn').style.display = 'block';
        document.getElementById('delete-playlist-btn').dataset.playlistId = playlistId;
    }

    renderPlaylistTracks(playlistId);
    modal.classList.add('active');
}

function closePlaylistModal() {
    document.getElementById('playlist-modal').classList.remove('active');
}

function renderPlaylistTracks(playlistId) {
    const container = document.getElementById('playlist-tracks-list');
    container.innerHTML = '';

    const playlist = playlistManager.getPlaylist(playlistId);
    if (!playlist) return;

    playlist.tracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = 'track-item';
        item.innerHTML = `
            <div class="track-item-info">
                <div class="track-item-title">${track.title || 'Без названия'}</div>
                <div class="track-item-artist">${track.artist || 'Неизвестный исполнитель'}</div>
            </div>
            <button class="result-item-action" data-action="remove">✕</button>
        `;

        const removeBtn = item.querySelector('[data-action="remove"]');
        removeBtn.addEventListener('click', () => {
            playlistManager.removeTrackFromPlaylist(playlistId, index);
            renderPlaylistTracks(playlistId);
            renderPlaylists();
        });

        item.addEventListener('click', () => {
            AppState.currentPlaylist = [...playlist.tracks];
            playTrack(index);
            closePlaylistModal();
        });

        container.appendChild(item);
    });
}

function savePlaylist() {
    const name = document.getElementById('playlist-name-input').value.trim();
    if (!name) {
        showToast('Введите название плейлиста', 'error');
        return;
    }

    const deleteBtn = document.getElementById('delete-playlist-btn');
    const playlistId = deleteBtn.dataset.playlistId;

    if (playlistId) {
        // Обновление существующего плейлиста
        const playlist = playlistManager.getPlaylist(playlistId);
        if (playlist) {
            playlist.name = name;
            storageManager.saveData();
            renderPlaylists();
            closePlaylistModal();
            showToast('Плейлист сохранен', 'success');
        }
    } else {
        // Создание нового плейлиста
        const playlist = playlistManager.createPlaylist(name);
        renderPlaylists();
        closePlaylistModal();
        showToast('Плейлист создан', 'success');
    }
}

function deletePlaylist() {
    const deleteBtn = document.getElementById('delete-playlist-btn');
    const playlistId = deleteBtn.dataset.playlistId;

    if (playlistId && confirm('Вы уверены, что хотите удалить этот плейлист?')) {
        playlistManager.deletePlaylist(playlistId);
        renderPlaylists();
        closePlaylistModal();
        showToast('Плейлист удален', 'success');
    }
}

// ===== Toast Notification =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tab}-tab`).classList.add('active');
        });
    });

    // Player controls
    document.getElementById('play-pause-btn').addEventListener('click', playPause);
    document.getElementById('prev-btn').addEventListener('click', playPrevious);
    document.getElementById('next-btn').addEventListener('click', playNext);
    document.getElementById('shuffle-btn').addEventListener('click', toggleShuffle);
    document.getElementById('repeat-btn').addEventListener('click', toggleRepeat);

    // Progress slider
    const progressSlider = document.getElementById('progress-slider');
    let isDragging = false;
    progressSlider.addEventListener('mousedown', () => isDragging = true);
    progressSlider.addEventListener('mouseup', () => isDragging = false);
    progressSlider.addEventListener('input', (e) => {
        if (!isDragging) {
            const time = (e.target.value / 100) * AppState.duration;
            audioPlayer.seek(time);
        }
    });
    progressSlider.addEventListener('change', (e) => {
        const time = (e.target.value / 100) * AppState.duration;
        audioPlayer.seek(time);
    });

    // Volume slider
    document.getElementById('volume-slider').addEventListener('input', (e) => {
        const volume = parseInt(e.target.value);
        audioPlayer.setVolume(volume);
        updateVolumeDisplay();
        storageManager.saveData();
    });

    // Search
    document.getElementById('search-btn').addEventListener('click', performSearch);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Search tabs
    document.querySelectorAll('.search-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.search-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.currentSearchType = btn.dataset.searchType;

            if (AppState.currentSearchType === 'file') {
                triggerFileUpload();
            }
        });
    });

    // Playlist modal
    document.getElementById('create-playlist-btn').addEventListener('click', () => {
        openPlaylistModal(null);
    });

    document.getElementById('playlist-modal-close').addEventListener('click', closePlaylistModal);
    document.getElementById('save-playlist-btn').addEventListener('click', savePlaylist);
    document.getElementById('delete-playlist-btn').addEventListener('click', deletePlaylist);

    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('active');
    });

    document.getElementById('settings-modal-close').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('active');
    });

    document.getElementById('theme-select').addEventListener('change', (e) => {
        AppState.theme = e.target.value;
        updateTheme();
        storageManager.saveData();
    });

    document.getElementById('clear-data-btn').addEventListener('click', () => {
        storageManager.clearAllData();
    });

    // Close modals on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

// ===== Search Functions =====
async function performSearch() {
    const query = document.getElementById('search-input').value.trim();

    if (!query) {
        showToast('Введите поисковый запрос', 'error');
        return;
    }

    let results = [];

    if (AppState.currentSearchType === 'local') {
        results = await searchEngine.searchLocal(query);
    } else if (AppState.currentSearchType === 'youtube') {
        results = await searchEngine.searchYouTube(query);
    } else if (AppState.currentSearchType === 'url') {
        const track = await searchEngine.searchByURL(query);
        if (track) results = [track];
    }

    AppState.searchResults = results;
    renderSearchResults(results);
}

function triggerFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.multiple = true;

    input.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);

        for (const file of files) {
            try {
                const track = await handleFileUpload(file);
                addTrackToCurrentPlaylist(track);
            } catch (error) {
                showToast(`Ошибка загрузки ${file.name}: ${error.message}`, 'error');
            }
        }

        showToast(`Загружено треков: ${files.length}`, 'success');
    });

    input.click();
}

// ===== Initialization =====
function init() {
    // Initialize Telegram WebApp
    initTelegramWebApp();

    // Setup event listeners
    setupEventListeners();

    // Load initial data
    renderPlaylists();
    updateVolumeDisplay();
    updateTheme();
    updateShuffleButton();
    updateRepeatButton();

    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }, 500);

    console.log('Music Player initialized');
}

// Start the app
document.addEventListener('DOMContentLoaded', init);


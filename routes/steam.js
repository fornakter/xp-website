const express = require('express');
const https = require('https');

const router = express.Router();

// Cache dla danych Steam (żeby nie odpytywać API zbyt często)
const gamesCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minut

// Helper do wykonywania zapytań HTTP
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    // Check for Steam API error responses
                    if (res.statusCode !== 200) {
                        console.log(`Steam API returned status ${res.statusCode}:`, parsed);
                        reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        return;
                    }
                    resolve(parsed);
                } catch (e) {
                    console.log(`Failed to parse JSON, status ${res.statusCode}, raw data:`, data.substring(0, 500));
                    reject(new Error('Invalid JSON response'));
                }
            });
        }).on('error', reject);
    });
}

// Middleware sprawdzający czy użytkownik jest zalogowany i ma Steam
function requireSteam(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Nie jesteś zalogowany'
        });
    }

    if (!req.session.user?.steamId) {
        return res.status(400).json({
            success: false,
            message: 'Konto Steam nie jest połączone'
        });
    }

    if (!process.env.STEAM_API_KEY) {
        return res.status(500).json({
            success: false,
            message: 'Steam API nie jest skonfigurowane'
        });
    }

    next();
}

// GET /api/steam/games - Pobierz listę gier użytkownika
router.get('/games', requireSteam, async (req, res) => {
    try {
        const steamId = req.session.user.steamId;
        const cacheKey = `games_${steamId}`;

        // Sprawdź cache
        const cached = gamesCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                games: cached.data,
                fromCache: true
            });
        }

        // Pobierz gry z Steam API
        const apiKey = process.env.STEAM_API_KEY;
        const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;

        const response = await fetchJSON(url);

        if (!response.response || !response.response.games) {
            return res.json({
                success: true,
                games: [],
                message: 'Brak gier lub profil jest prywatny'
            });
        }

        // Przetwórz dane gier
        const games = response.response.games.map(game => ({
            appId: game.appid,
            name: game.name,
            playtime: game.playtime_forever, // w minutach
            playtimeHours: Math.round(game.playtime_forever / 60 * 10) / 10,
            playtime2Weeks: game.playtime_2weeks || 0,
            iconUrl: game.img_icon_url
                ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
                : null,
            logoUrl: game.img_logo_url
                ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`
                : null,
            headerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
            lastPlayed: game.rtime_last_played || null
        }));

        // Sortuj po czasie gry (malejąco)
        games.sort((a, b) => b.playtime - a.playtime);

        // Zapisz w cache
        gamesCache.set(cacheKey, {
            data: games,
            timestamp: Date.now()
        });

        res.json({
            success: true,
            games: games,
            totalGames: response.response.game_count,
            steamId: steamId
        });

    } catch (error) {
        console.error('Steam games fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania listy gier'
        });
    }
});

// GET /api/steam/games/:steamId - Pobierz gry innego użytkownika (jeśli publiczne)
router.get('/games/:steamId', async (req, res) => {
    try {
        if (!process.env.STEAM_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Steam API nie jest skonfigurowane'
            });
        }

        const steamId = req.params.steamId;

        // Walidacja Steam ID (64-bit)
        if (!/^\d{17}$/.test(steamId)) {
            return res.status(400).json({
                success: false,
                message: 'Nieprawidłowy format Steam ID'
            });
        }

        const cacheKey = `games_${steamId}`;

        // Sprawdź cache
        const cached = gamesCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({
                success: true,
                games: cached.data,
                fromCache: true
            });
        }

        // Pobierz gry z Steam API
        const apiKey = process.env.STEAM_API_KEY;
        const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;

        const response = await fetchJSON(url);

        if (!response.response || !response.response.games) {
            return res.json({
                success: true,
                games: [],
                message: 'Brak gier lub profil jest prywatny'
            });
        }

        // Przetwórz dane gier
        const games = response.response.games.map(game => ({
            appId: game.appid,
            name: game.name,
            playtime: game.playtime_forever,
            playtimeHours: Math.round(game.playtime_forever / 60 * 10) / 10,
            playtime2Weeks: game.playtime_2weeks || 0,
            iconUrl: game.img_icon_url
                ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
                : null,
            headerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
            lastPlayed: game.rtime_last_played || null
        }));

        games.sort((a, b) => b.playtime - a.playtime);

        // Zapisz w cache
        gamesCache.set(cacheKey, {
            data: games,
            timestamp: Date.now()
        });

        res.json({
            success: true,
            games: games,
            totalGames: response.response.game_count,
            steamId: steamId
        });

    } catch (error) {
        console.error('Steam games fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania listy gier'
        });
    }
});

// GET /api/steam/profile - Pobierz profil Steam zalogowanego użytkownika
router.get('/profile', requireSteam, async (req, res) => {
    try {
        const steamId = req.session.user.steamId;
        const apiKey = process.env.STEAM_API_KEY;

        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`;

        const response = await fetchJSON(url);

        if (!response.response || !response.response.players || response.response.players.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Nie znaleziono profilu Steam'
            });
        }

        const player = response.response.players[0];

        res.json({
            success: true,
            profile: {
                steamId: player.steamid,
                personaName: player.personaname,
                profileUrl: player.profileurl,
                avatar: player.avatar,
                avatarMedium: player.avatarmedium,
                avatarFull: player.avatarfull,
                personaState: player.personastate, // 0=Offline, 1=Online, 2=Busy, etc.
                visibility: player.communityvisibilitystate, // 1=Private, 3=Public
                lastLogoff: player.lastlogoff
            }
        });

    } catch (error) {
        console.error('Steam profile fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania profilu Steam'
        });
    }
});

// GET /api/steam/profile/:steamId - Pobierz profil innego użytkownika Steam
router.get('/profile/:steamId', async (req, res) => {
    try {
        if (!process.env.STEAM_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Steam API nie jest skonfigurowane'
            });
        }

        const steamId = req.params.steamId;

        if (!/^\d{17}$/.test(steamId)) {
            return res.status(400).json({
                success: false,
                message: 'Nieprawidłowy format Steam ID'
            });
        }

        const apiKey = process.env.STEAM_API_KEY;
        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`;

        const response = await fetchJSON(url);

        if (!response.response || !response.response.players || response.response.players.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Nie znaleziono profilu Steam'
            });
        }

        const player = response.response.players[0];

        res.json({
            success: true,
            profile: {
                steamId: player.steamid,
                personaName: player.personaname,
                profileUrl: player.profileurl,
                avatar: player.avatar,
                avatarMedium: player.avatarmedium,
                avatarFull: player.avatarfull,
                personaState: player.personastate,
                visibility: player.communityvisibilitystate,
                lastLogoff: player.lastlogoff
            }
        });

    } catch (error) {
        console.error('Steam profile fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania profilu Steam'
        });
    }
});

// GET /api/steam/resolve/:vanityUrl - Zamień vanity URL na Steam ID
router.get('/resolve/:vanityUrl', async (req, res) => {
    try {
        if (!process.env.STEAM_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Steam API nie jest skonfigurowane'
            });
        }

        const vanityUrl = req.params.vanityUrl;
        const apiKey = process.env.STEAM_API_KEY;

        const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(vanityUrl)}`;

        const response = await fetchJSON(url);

        if (!response.response || response.response.success !== 1) {
            return res.status(404).json({
                success: false,
                message: 'Nie znaleziono użytkownika Steam'
            });
        }

        res.json({
            success: true,
            steamId: response.response.steamid
        });

    } catch (error) {
        console.error('Steam resolve error:', error);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas wyszukiwania użytkownika'
        });
    }
});

// Cache dla osiągnięć
const achievementsCache = new Map();
const ACHIEVEMENTS_CACHE_TTL = 10 * 60 * 1000; // 10 minut

// GET /api/steam/achievements/:appId - Pobierz osiągnięcia dla gry
router.get('/achievements/:appId', async (req, res) => {
    console.log(`[Achievements] Request for appId=${req.params.appId}, userId=${req.session?.userId}, steamId=${req.session?.user?.steamId}`);
    try {
        if (!req.session.userId || !req.session.user?.steamId) {
            console.log('[Achievements] Unauthorized - missing session userId or steamId');
            return res.status(401).json({
                success: false,
                message: 'Nie jesteś zalogowany lub brak połączenia Steam'
            });
        }

        if (!process.env.STEAM_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Steam API nie jest skonfigurowane'
            });
        }

        const appId = req.params.appId;
        const steamId = req.session.user.steamId;
        const cacheKey = `achievements_${steamId}_${appId}`;

        // Sprawdź cache
        const cached = achievementsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ACHIEVEMENTS_CACHE_TTL) {
            return res.json({
                success: true,
                ...cached.data,
                fromCache: true
            });
        }

        const apiKey = process.env.STEAM_API_KEY;
        const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appId}&l=polish`;

        console.log(`Fetching achievements for appId=${appId}, steamId=${steamId}`);
        const response = await fetchJSON(url);
        console.log(`Achievements response for ${appId}:`, JSON.stringify(response).substring(0, 500));

        // Gra może nie mieć osiągnięć lub błąd w odpowiedzi
        if (!response.playerstats) {
            console.log(`No playerstats in response for ${appId}`);
            return res.json({
                success: true,
                appId: parseInt(appId),
                hasAchievements: false,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        // Sprawdź czy są osiągnięcia lub czy Steam zwrócił sukces=false
        if (response.playerstats.success === false || !response.playerstats.achievements) {
            console.log(`No achievements or success=false for ${appId}:`, response.playerstats.error || 'no error message');
            return res.json({
                success: true,
                appId: parseInt(appId),
                hasAchievements: false,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        const achievements = response.playerstats.achievements;
        const total = achievements.length;
        const unlocked = achievements.filter(a => a.achieved === 1).length;
        const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;

        const result = {
            appId: parseInt(appId),
            hasAchievements: true,
            total,
            unlocked,
            percentage,
            gameName: response.playerstats.gameName
        };

        // Zapisz w cache
        achievementsCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        // Steam zwraca HTTP 400 dla gier bez osiągnięć - to normalne
        if (error.message === 'Invalid JSON response' || error.message.includes('HTTP 400')) {
            console.log(`[Achievements] Game ${req.params.appId} has no achievements (HTTP 400)`);
            return res.json({
                success: true,
                appId: parseInt(req.params.appId),
                hasAchievements: false,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        // Prawdziwy błąd
        console.error('Steam achievements fetch error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania osiągnięć'
        });
    }
});

// GET /api/steam/achievements/:appId/:steamId - Pobierz osiągnięcia dla gry dla konkretnego użytkownika
router.get('/achievements/:appId/:steamId', async (req, res) => {
    console.log(`[FriendAchievements] Request for appId=${req.params.appId}, friendSteamId=${req.params.steamId}`);
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: 'Nie jesteś zalogowany'
            });
        }

        if (!process.env.STEAM_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Steam API nie jest skonfigurowane'
            });
        }

        const appId = req.params.appId;
        const steamId = req.params.steamId;

        // Walidacja Steam ID
        if (!/^\d{17}$/.test(steamId)) {
            return res.status(400).json({
                success: false,
                message: 'Nieprawidłowy format Steam ID'
            });
        }

        const cacheKey = `achievements_${steamId}_${appId}`;

        // Sprawdź cache
        const cached = achievementsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ACHIEVEMENTS_CACHE_TTL) {
            return res.json({
                success: true,
                ...cached.data,
                fromCache: true
            });
        }

        const apiKey = process.env.STEAM_API_KEY;
        const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appId}&l=polish`;

        console.log(`Fetching achievements for friend appId=${appId}, steamId=${steamId}`);
        const response = await fetchJSON(url);

        if (!response.playerstats) {
            return res.json({
                success: true,
                appId: parseInt(appId),
                hasAchievements: false,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        if (response.playerstats.success === false || !response.playerstats.achievements) {
            return res.json({
                success: true,
                appId: parseInt(appId),
                hasAchievements: false,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        const achievements = response.playerstats.achievements;
        const total = achievements.length;
        const unlocked = achievements.filter(a => a.achieved === 1).length;
        const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;

        const result = {
            appId: parseInt(appId),
            hasAchievements: true,
            total,
            unlocked,
            percentage
        };

        achievementsCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        // Steam zwraca HTTP 400 dla gier bez osiągnięć - to normalne
        if (error.message === 'Invalid JSON response' || error.message.includes('HTTP 400')) {
            console.log(`[FriendAchievements] Game ${req.params.appId} has no achievements (HTTP 400)`);
            return res.json({
                success: true,
                appId: parseInt(req.params.appId),
                hasAchievements: false,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        // Steam zwraca HTTP 403 dla prywatnych profili
        if (error.message.includes('HTTP 403') || error.message.includes('Profile is not public')) {
            console.log(`[FriendAchievements] Game ${req.params.appId} - private profile`);
            return res.json({
                success: true,
                appId: parseInt(req.params.appId),
                hasAchievements: false,
                isPrivate: true,
                total: 0,
                unlocked: 0,
                percentage: 0
            });
        }

        // Prawdziwy błąd
        console.error('Steam friend achievements fetch error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania osiągnięć'
        });
    }
});

// GET /api/steam/friends - Pobierz listę znajomych Steam
router.get('/friends', requireSteam, async (req, res) => {
    try {
        const apiKey = process.env.STEAM_API_KEY;
        const steamId = req.session.user.steamId;

        // Pobierz listę znajomych
        const friendsUrl = `https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${steamId}&relationship=friend`;
        const friendsResponse = await fetchJSON(friendsUrl);

        if (!friendsResponse.friendslist || !friendsResponse.friendslist.friends) {
            return res.json({
                success: true,
                friends: [],
                message: 'Brak znajomych lub lista jest prywatna'
            });
        }

        const friendIds = friendsResponse.friendslist.friends.map(f => f.steamid);

        if (friendIds.length === 0) {
            return res.json({
                success: true,
                friends: []
            });
        }

        // Pobierz dane profili znajomych (max 100 na raz)
        const profilesUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${friendIds.join(',')}`;
        const profilesResponse = await fetchJSON(profilesUrl);

        if (!profilesResponse.response || !profilesResponse.response.players) {
            return res.json({
                success: true,
                friends: []
            });
        }

        // Mapuj dane znajomych
        const friends = profilesResponse.response.players.map(player => ({
            steamId: player.steamid,
            username: player.personaname,
            avatarUrl: player.avatarmedium || player.avatar,
            profileUrl: player.profileurl,
            isOnline: player.personastate > 0
        }));

        // Sortuj: online na górze, potem alfabetycznie
        friends.sort((a, b) => {
            if (a.isOnline !== b.isOnline) return b.isOnline - a.isOnline;
            return a.username.localeCompare(b.username);
        });

        res.json({
            success: true,
            friends: friends,
            total: friends.length
        });

    } catch (error) {
        console.error('Steam friends fetch error:', error.message);

        // Lista znajomych może być prywatna
        if (error.message.includes('HTTP 401') || error.message.includes('HTTP 403')) {
            return res.json({
                success: true,
                friends: [],
                message: 'Lista znajomych jest prywatna'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania listy znajomych'
        });
    }
});

// Cache dla cen z gg.deals
const pricesCache = new Map();
const PRICES_CACHE_TTL = 30 * 60 * 1000; // 30 minut

// GET /api/steam/prices - Pobierz ceny gier z gg.deals
router.get('/prices', async (req, res) => {
    try {
        const { appIds } = req.query;

        if (!appIds) {
            return res.status(400).json({
                success: false,
                message: 'Brak parametru appIds'
            });
        }

        const ggDealsApiKey = process.env.GGDEALS_API_KEY;

        if (!ggDealsApiKey) {
            return res.status(500).json({
                success: false,
                message: 'GG.deals API nie jest skonfigurowane'
            });
        }

        // Parsuj appIds (max 100)
        const ids = appIds.split(',').slice(0, 100);
        const cacheKey = `prices_${ids.sort().join('_')}`;

        // Sprawdź cache
        const cached = pricesCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < PRICES_CACHE_TTL) {
            return res.json({
                success: true,
                prices: cached.data,
                fromCache: true
            });
        }

        // Pobierz ceny z gg.deals API
        const url = `https://api.gg.deals/v1/prices/by-steam-app-id/?ids=${ids.join(',')}&key=${ggDealsApiKey}&region=pl`;

        const response = await new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            }).on('error', reject);
        });

        // Przetwórz odpowiedź - priorytet: keyshops (Kinguin, G2A, itp.)
        const prices = {};
        if (response.data) {
            for (const [appId, gameData] of Object.entries(response.data)) {
                if (gameData && gameData.prices) {
                    const p = gameData.prices;

                    // Priorytet: cena z keyshopów, potem retail
                    const currentKeyshop = p.currentKeyshops ? parseFloat(p.currentKeyshops) : null;
                    const currentRetail = p.currentRetail ? parseFloat(p.currentRetail) : null;

                    // Użyj najniższej ceny z keyshopów (Kinguin, G2A, itp.)
                    const current = currentKeyshop || currentRetail;

                    // Historyczna najniższa cena
                    const historicalKeyshop = p.historicalKeyshops ? parseFloat(p.historicalKeyshops) : null;
                    const historicalRetail = p.historicalRetail ? parseFloat(p.historicalRetail) : null;
                    const historicalLow = Math.min(
                        historicalKeyshop || Infinity,
                        historicalRetail || Infinity
                    );

                    // Oblicz zniżkę vs cena retail Steam
                    let discount = 0;
                    if (current && currentRetail && currentRetail > current) {
                        discount = Math.round((1 - current / currentRetail) * 100);
                    }

                    prices[appId] = {
                        currentPrice: current,
                        regularPrice: currentRetail,
                        discount: discount,
                        currency: p.currency || 'PLN',
                        url: gameData.url || `https://gg.deals/game/?steam_app_id=${appId}`,
                        historicalLow: historicalLow === Infinity ? null : historicalLow,
                        source: currentKeyshop ? 'keyshop' : 'retail'
                    };
                } else {
                    prices[appId] = null;
                }
            }
        }

        // Zapisz do cache
        pricesCache.set(cacheKey, {
            data: prices,
            timestamp: Date.now()
        });

        res.json({
            success: true,
            prices: prices
        });

    } catch (error) {
        console.error('GG.deals prices fetch error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Błąd podczas pobierania cen'
        });
    }
});

module.exports = router;

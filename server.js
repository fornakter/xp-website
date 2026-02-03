require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const path = require('path');

// Importy lokalne
const authRoutes = require('./routes/auth');
const { userQueries } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// Passport Steam Configuration
// ==========================================

if (process.env.STEAM_API_KEY) {
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser((id, done) => {
        const user = userQueries.findById.get(id);
        done(null, user);
    });

    passport.use(new SteamStrategy({
        returnURL: process.env.STEAM_RETURN_URL || `http://localhost:${PORT}/api/auth/steam/callback`,
        realm: process.env.STEAM_REALM || `http://localhost:${PORT}/`,
        apiKey: process.env.STEAM_API_KEY
    }, (identifier, profile, done) => {
        const steamId = profile.id;
        const steamUsername = profile.displayName;
        const avatarUrl = profile.photos[2]?.value || profile.photos[0]?.value || null;

        // Sprawdź czy użytkownik z tym Steam ID już istnieje
        let user = userQueries.findBySteamId.get(steamId);

        if (user) {
            // Użytkownik istnieje - aktualizuj ostatnie logowanie
            userQueries.updateLastLogin.run(user.id);
            return done(null, user);
        }

        // Nowy użytkownik - utwórz konto
        try {
            const email = `steam_${steamId}@gamezone.local`; // Placeholder email
            const result = userQueries.createWithSteam.run(
                steamUsername,
                email,
                steamId,
                steamUsername,
                avatarUrl
            );
            user = userQueries.findById.get(result.lastInsertRowid);
            return done(null, user);
        } catch (error) {
            return done(error, null);
        }
    }));
}

// ==========================================
// Middleware
// ==========================================

// Parsowanie JSON i form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfiguracja sesji
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // HTTPS w produkcji
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 godziny domyślnie
    }
};

app.use(session(sessionConfig));

// Inicjalizacja Passport
app.use(passport.initialize());
app.use(passport.session());

// Serwowanie statycznych plików z folderu public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// Trasy API
// ==========================================

app.use('/api/auth', authRoutes);

// ==========================================
// Obsługa błędów
// ==========================================

// 404 dla nieznanych tras API
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint nie został znaleziony'
    });
});

// Przekierowanie na index.html dla SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Globalny handler błędów
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Wystąpił błąd serwera'
    });
});

// ==========================================
// Start serwera
// ==========================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🎮 GameZone Portal Server                       ║
║                                                   ║
║   Serwer uruchomiony na: http://localhost:${PORT}   ║
║                                                   ║
║   Dostępne endpointy:                             ║
║   - POST /api/auth/register                       ║
║   - POST /api/auth/login                          ║
║   - POST /api/auth/logout                         ║
║   - GET  /api/auth/me                             ║
║   - GET  /api/auth/steam                          ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);

    if (!process.env.SESSION_SECRET) {
        console.warn('⚠️  UWAGA: Używasz domyślnego sekretu sesji!');
        console.warn('   Ustaw SESSION_SECRET w pliku .env dla bezpieczeństwa.\n');
    }

    if (process.env.STEAM_API_KEY) {
        console.info('✅ Steam OAuth jest skonfigurowane i gotowe.\n');
    } else {
        console.info('ℹ️  INFO: Logowanie przez Steam nie jest skonfigurowane.');
        console.info('   Dodaj STEAM_API_KEY do pliku .env aby włączyć.\n');
    }
});

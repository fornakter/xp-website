const express = require('express');
const bcrypt = require('bcrypt');
const passport = require('passport');
const { userQueries } = require('../database/init');

const router = express.Router();

const SALT_ROUNDS = 10;

// Walidacja email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Walidacja hasła (min 8 znaków)
function isValidPassword(password) {
    return password && password.length >= 8;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Walidacja danych
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Wszystkie pola są wymagane'
            });
        }

        if (username.length < 3 || username.length > 30) {
            return res.status(400).json({
                success: false,
                message: 'Nazwa użytkownika musi mieć 3-30 znaków'
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Nieprawidłowy format adresu email'
            });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({
                success: false,
                message: 'Hasło musi mieć co najmniej 8 znaków'
            });
        }

        // Sprawdź czy użytkownik już istnieje
        const existingUser = userQueries.findByEmail.get(email);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'Użytkownik z tym adresem email już istnieje'
            });
        }

        // Hashowanie hasła
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Tworzenie użytkownika
        const result = userQueries.create.run(username, email, passwordHash);

        // Pobierz utworzonego użytkownika
        const newUser = userQueries.findById.get(result.lastInsertRowid);

        // Ustaw sesję
        req.session.userId = newUser.id;
        req.session.user = {
            id: newUser.id,
            username: newUser.username,
            email: newUser.email
        };

        res.status(201).json({
            success: true,
            message: 'Konto zostało utworzone',
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email
            }
        });

    } catch (error) {
        console.error('Registration error:', error);

        // Sprawdź błąd unikalności
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({
                success: false,
                message: 'Nazwa użytkownika lub email jest już zajęty'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Wystąpił błąd podczas rejestracji'
        });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password, remember } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email i hasło są wymagane'
            });
        }

        // Znajdź użytkownika
        const user = userQueries.findByEmail.get(email);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Nieprawidłowy email lub hasło'
            });
        }

        // Sprawdź czy użytkownik ma hasło (może być konto Steam-only)
        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                message: 'To konto używa logowania przez Steam'
            });
        }

        // Weryfikacja hasła
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Nieprawidłowy email lub hasło'
            });
        }

        // Aktualizuj ostatnie logowanie
        userQueries.updateLastLogin.run(user.id);

        // Ustaw sesję
        req.session.userId = user.id;
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            steamId: user.steam_id,
            steamUsername: user.steam_username,
            avatarUrl: user.avatar_url
        };

        // Przedłuż sesję jeśli "zapamiętaj mnie"
        if (remember) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 dni
        }

        res.json({
            success: true,
            message: 'Zalogowano pomyślnie',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                steamUsername: user.steam_username,
                avatarUrl: user.avatar_url
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Wystąpił błąd podczas logowania'
        });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({
                success: false,
                message: 'Wystąpił błąd podczas wylogowywania'
            });
        }

        res.clearCookie('connect.sid');
        res.json({
            success: true,
            message: 'Wylogowano pomyślnie'
        });
    });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Nie jesteś zalogowany'
        });
    }

    res.json({
        success: true,
        user: req.session.user
    });
});

// ================================================
// Steam OAuth
// ================================================

// GET /api/auth/steam
router.get('/steam', (req, res, next) => {
    if (!process.env.STEAM_API_KEY) {
        return res.redirect('/login.html?error=steam_not_configured');
    }

    passport.authenticate('steam', { failureRedirect: '/login.html?error=steam_failed' })(req, res, next);
});

// GET /api/auth/steam/callback
router.get('/steam/callback', (req, res, next) => {
    if (!process.env.STEAM_API_KEY) {
        return res.redirect('/login.html?error=steam_not_configured');
    }

    passport.authenticate('steam', { failureRedirect: '/login.html?error=steam_failed' }, (err, user) => {
        if (err || !user) {
            console.error('Steam auth error:', err);
            return res.redirect('/login.html?error=steam_failed');
        }

        // Ustaw sesję
        req.session.userId = user.id;
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            steamId: user.steam_id,
            steamUsername: user.steam_username,
            avatarUrl: user.avatar_url
        };

        // Aktualizuj ostatnie logowanie
        userQueries.updateLastLogin.run(user.id);

        res.redirect('/?login=steam_success');
    })(req, res, next);
});

module.exports = router;

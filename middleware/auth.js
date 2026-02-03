// Middleware sprawdzający czy użytkownik jest zalogowany
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Musisz być zalogowany aby wykonać tę akcję'
        });
    }
    next();
}

// Middleware dla stron HTML - przekierowanie do logowania
function requireAuthPage(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }
    next();
}

// Middleware sprawdzający czy użytkownik NIE jest zalogowany (dla stron login/register)
function requireGuest(req, res, next) {
    if (req.session.userId) {
        return res.redirect('/');
    }
    next();
}

module.exports = {
    requireAuth,
    requireAuthPage,
    requireGuest
};

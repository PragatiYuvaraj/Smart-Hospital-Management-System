/**
 * Role-based authorization middleware
 * @param  {...string} allowedRoles - Roles permitted to access the route
 */
const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required prior to authorization.',
        errors: []
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not authorized to access this resource.`,
        errors: []
      });
    }

    next();
  };
};

/**
 * Permission-based authorization middleware (for doctor subtypes e.g. DUTY_DOCTOR)
 * @param {string} permission - Required permission key
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
        errors: []
      });
    }

    const userPermissions = req.user.permissions || [];
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Missing required permission: '${permission}'.`,
        errors: []
      });
    }

    next();
  };
};

module.exports = { authorizeRole, requirePermission };

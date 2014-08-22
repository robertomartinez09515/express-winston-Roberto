// Copyright (c) 2012-2014 Heapsource.com and Contributors - http://www.heapsource.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
var winston = require('winston');
var util = require('util');
var chalk = require('chalk');

//Allow this file to get an exclusive copy of underscore so it can change the template settings without affecting others
delete require.cache[require.resolve('underscore')];
var _ = require('underscore');
delete require.cache[require.resolve('underscore')];

/**
 * A default list of properties in the request object that are allowed to be logged.
 * These properties will be safely included in the meta of the log.
 * 'body' is not included in this list because it can contains passwords and stuff that are sensitive for logging.
 * TODO: Include 'body' and get the defaultRequestFilter to filter the inner properties like 'password' or 'password_confirmation', etc. Pull requests anyone?
 * @type {Array}
 */
var requestWhitelist = ['url', 'headers', 'method', 'httpVersion', 'originalUrl', 'query'];

/**
 * A default list of properties in the request body that are allowed to be logged.
 * This will normally be empty here, since it should be done at the route level.
 * @type {Array}
 */
var bodyWhitelist = [];

/**
 * A default list of properties in the request body that are not allowed to be logged.
 * @type {Array}
 */
var bodyBlacklist = [];

/**
 * A default list of properties in the response object that are allowed to be logged.
 * These properties will be safely included in the meta of the log.
 * @type {Array}
 */
var responseWhitelist = ['statusCode'];

/**
 * A default function to filter the properties of the req object.
 * @param req
 * @param propName
 * @return {*}
 */
var defaultRequestFilter = function (req, propName) {
    return req[propName];
};

/**
 * A default function to filter the properties of the res object.
 * @param res
 * @param propName
 * @return {*}
 */
var defaultResponseFilter = function (req, propName) {
    return req[propName];
};

function filterObject(originalObj, whiteList, initialFilter) {

    var obj = {};
    var fieldsSet = false;

    [].concat(whiteList).forEach(function (propName) {
        var value = initialFilter(originalObj, propName);

        if(typeof (value) !== 'undefined') {
            obj[propName] = value;
            fieldsSet = true;
        };
    });

    return fieldsSet?obj:undefined;
}

//
// ### function errorLogger(options)
// #### @options {Object} options to initialize the middleware.
//


function errorLogger(options) {

    ensureValidOptions(options);

    options.requestFilter = options.requestFilter || defaultRequestFilter;
    options.winstonInstance = options.winstonInstance || (new winston.Logger ({ transports: options.transports }));

    return function (err, req, res, next) {

        // Let winston gather all the error data.
        var exceptionMeta = winston.exception.getAllInfo(err);
        exceptionMeta.req = filterObject(req, requestWhitelist, options.requestFilter);

        // This is fire and forget, we don't want logging to hold up the request so don't wait for the callback
        options.winstonInstance.log('error', 'middlewareError', exceptionMeta, function () {
            // Nothing to do here
        });

        next(err);
    };
}

//
// ### function logger(options)
// #### @options {Object} options to initialize the middleware.
//


function logger(options) {

    ensureValidOptions(options);

    options.requestFilter = options.requestFilter || defaultRequestFilter;
    options.responseFilter = options.responseFilter || defaultResponseFilter;
    options.winstonInstance = options.winstonInstance || (new winston.Logger ({ transports: options.transports }));
    options.level = options.level || "info";
    options.statusLevels = options.statusLevels || false;
    options.msg = options.msg || "HTTP {{req.method}} {{req.url}}";
    options.colorStatus = options.colorStatus || false;
    options.expressFormat = options.expressFormat || false;

    return function (req, res, next) {

        req._startTime = (new Date);

        req._routeWhitelists = {
            req: [],
            res: [],
            body: []
        };

        req._routeBlacklists = {
            body: []
        };

        // Manage to get information from the response too, just like Connect.logger does:
        var end = res.end;
        res.end = function(chunk, encoding) {
            res.responseTime = (new Date) - req._startTime;

            res.end = end;
            res.end(chunk, encoding);

            if (options.statusLevels) {
              if (res.statusCode >= 100) { options.level = "info"; }
              if (res.statusCode >= 400) { options.level = "warn"; }
              if (res.statusCode >= 500) { options.level = "error"; }
            };

            if ((options.colorStatus) || (options.expressFormat)) {
              // Palette from https://github.com/expressjs/morgan/blob/master/index.js#L205
              var statusColor = 'green';
              if (res.statusCode >= 500) statusColor = 'red';
              else if (res.statusCode >= 400) statusColor = 'yellow';
              else if (res.statusCode >= 300) statusColor = 'cyan';
              var coloredStatusCode = chalk[statusColor](res.statusCode);
            }

            var meta = {};

            if(options.meta !== false) {
              var bodyWhitelist, blacklist;

              requestWhitelist = requestWhitelist.concat(req._routeWhitelists.req || []);
              responseWhitelist = responseWhitelist.concat(req._routeWhitelists.res || []);

              meta.req = filterObject(req, requestWhitelist, options.requestFilter);
              meta.res = filterObject(res, responseWhitelist, options.responseFilter);
              if (_.contains(responseWhitelist, 'body')) {
                  meta.res.body = res._headers['content-type'].indexOf('json') >= 0 ? JSON.parse(chunk) : chunk;
              }

              bodyWhitelist = req._routeWhitelists.body || [];
              blacklist = _.union(bodyBlacklist, (req._routeBlacklists.body || []));

              if (blacklist.length > 0 && bodyWhitelist.length === 0) {
                var whitelist = _.difference(_.keys(req.body), blacklist);
                meta.req.body = filterObject(req.body, whitelist, options.requestFilter);
              } else {
                meta.req.body = filterObject(req.body, bodyWhitelist, options.requestFilter);
              }

              meta.responseTime = res.responseTime;
            }

            if(options.expressFormat) {
              var msg = chalk.grey(req.method+" "+req.url)+" "+chalk[statusColor](res.statusCode)+" "+chalk.grey(res.responseTime+"ms");
            } else {
              // Using mustache style templating
              _.templateSettings = {
                interpolate: /\{\{(.+?)\}\}/g
              };
              var template = _.template(options.msg);
              var msg = template({req: req, res: res});
            }
            // This is fire and forget, we don't want logging to hold up the request so don't wait for the callback
            options.winstonInstance.log(options.level, msg, meta, function () {
                // Nothing to do here
            });
        };

        next();
    };
}

function ensureValidOptions(options) {
    if(!options) throw new Error("options are required by express-winston middleware");
    if(!((options.transports && (options.transports.length > 0)) || options.winstonInstance))
        throw new Error("transports or a winstonInstance are required by express-winston middleware");
};

module.exports.errorLogger = errorLogger;
module.exports.logger = logger;
module.exports.requestWhitelist = requestWhitelist;
module.exports.bodyWhitelist = bodyWhitelist;
module.exports.bodyBlacklist = bodyBlacklist;
module.exports.responseWhitelist = responseWhitelist;
module.exports.defaultRequestFilter = defaultRequestFilter;
module.exports.defaultResponseFilter = defaultResponseFilter;

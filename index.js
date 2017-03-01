#!/usr/bin/env node

var program = require('commander');
var request = require('request');
var moment = require('moment');
var R = require('ramda');
var table = require('cli-table');

var user = process.env.PAPERSHIFT_USER;
var auth_token = process.env.PAPERSHIFT_TOKEN;

if (!user) {
    console.error('PAPERSHIFT_USER Environment variable is not defiend');
    return 1;
}
if (!auth_token) {
    console.error('PAPERSHIFT_TOKEN Environment variable is not defiend');
    return 1;
}

program.version('0.0.1').parse(process.argv);

var URL = 'https://app.papershift.com/public_api/v1/';
var WORKING_SESSIONS = URL + 'working_sessions';

var headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

var defaultParameters = {
    api_token: auth_token,
    user_id: user
};

var createParameters = function (parameters) {
    return Object.assign({}, defaultParameters, parameters);
};

var NOW = moment();

var getTimeDiffText = function (start, end, breakMinutes) {
    if (breakMinutes) {
        if (start > end) {
            start.subtract(breakMinutes, 'minutes');
        } else {
            end.subtract(breakMinutes, 'minutes');
        }
    }
    var duration = moment.duration(start.diff(end));
    return [
        Math.abs(duration.hours()),
        Math.abs(duration.minutes()),
        Math.abs(duration.seconds())
    ].join(':');
};

var getTimeDiff = function (start, end) {
    var duration = moment.duration(start.diff(end));
    return Math.floor(Math.abs(duration.asMinutes()));
};

var todaySummary = function () {
    console.log('Build summary...');
    var parameters = createParameters({
        range_start: moment().utc().toISOString(),
        range_end: moment().add(1, 'days').utc().toISOString()
    });

    request({url: WORKING_SESSIONS, qs: parameters, headers: headers}, function (error, response, body) {
        var data = JSON.parse(body);
        var current = R.head(data.working_sessions);
        if (current) {
            var breaks = current.breaks;
            var breakMinutes = 0;
            if (breaks) {
                breakMinutes = R.map(function (current) {
                    var start = current.starts_at ? moment(current.starts_at) : null;
                    var end = current.ends_at ? moment(current.ends_at) : null;

                    if (start && end) {
                        return getTimeDiff(start, end);
                    } else {
                        return 0;
                    }
                }, breaks);
                breakMinutes = R.sum(breakMinutes);
            }

            var start = current.starts_at ? moment(current.starts_at) : null;
            var end = current.ends_at ? moment(current.ends_at) : null;

            if (start && end) {
                console.log('Worked from', start.format('HH:mm'), 'to', end.format('HH:mm'), 'worked for', getTimeDiffText(start, end, breakMinutes));
            } else if (start) {
                console.log('Started at', start.format('HH:mm'), 'worked for', getTimeDiffText(start, NOW, breakMinutes));
            } else {
                console.error('Something went wrong');
            }
        } else {
            console.error('Not worked today');
        }
    });
};

todaySummary();
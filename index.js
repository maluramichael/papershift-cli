#!/usr/bin/env node

var program = require('commander');
var request = require('request');
var moment = require('moment');
var R = require('ramda');
var Table = require('cli-table');

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

var HOURS_TO_WORK = 8;
var MINUTES_TO_WORK = HOURS_TO_WORK * 60;

var getDifferenceInMinutesText = function (start, end, breakMinutes) {
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

var getHumanReadableTextFromMinutes = function (minutes) {
    var duration = moment.duration(minutes, 'minutes');
    var negative = duration < 0;

    return (negative ? '-' : '') + [
            Math.abs(duration.hours()),
            Math.abs(duration.minutes()),
            Math.abs(duration.seconds())
        ].join(':');
};

const getDifferenceInMinutes = function (start, end) {
    var duration = moment.duration(start.diff(end));
    return Math.floor(Math.abs(duration.asMinutes()));
};

var todaySummary = function () {
    console.log('Build summary...');
    var parameters = createParameters({
        range_start: moment().utc().toISOString(),
        range_end: moment().add(1, 'days').utc().toISOString()
    });

    request({
        url: WORKING_SESSIONS,
        qs: parameters,
        headers: headers
    }, function (error, response, body) {
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
                        return getDifferenceInMinutes(start, end);
                    } else {
                        return 0;
                    }
                }, breaks);
                breakMinutes = R.sum(breakMinutes);
            }

            var start = current.starts_at ? moment(current.starts_at) : null;
            var end = current.ends_at ? moment(current.ends_at) : null;

            if (start && end) {
                console.log('Worked from', start.format('HH:mm'), 'to', end.format('HH:mm'), 'worked for', getDifferenceInMinutesText(start, end, breakMinutes));
            } else if (start) {
                console.log('Started at', start.format('HH:mm'), 'worked for', getDifferenceInMinutesText(start, moment(), breakMinutes));
            } else {
                console.error('Something went wrong');
            }
        } else {
            console.error('Not worked today');
        }
    });
};

const getBreaksInMinutes = function (breaks) {
    var breakMinutes = 0;
    if (breaks) {
        breakMinutes = R.map(function (current) {
            var start = current.starts_at ? moment(current.starts_at) : null;
            var end = current.ends_at ? moment(current.ends_at) : null;

            if (start && end) {
                return getDifferenceInMinutes(start, end);
            } else {
                return 0;
            }
        }, breaks);
        return R.sum(breakMinutes);
    }
    return 0;
};

const getWorkTimeInMinutes = function (session) {
    var start = session.starts_at ? moment(session.starts_at) : null;
    var end = session.ends_at ? moment(session.ends_at) : null;

    if (start && end) {
        return getDifferenceInMinutes(start, end);
    } else if (start) {
        return getDifferenceInMinutes(start, moment());
    }

    return 0;
};

const getOvertimeFromSession = function (session) {
    const breaksInMinutes = getBreaksInMinutes(session.breaks);
    const workTimeInMinutes = getWorkTimeInMinutes(session);

    const actualWorkTime = workTimeInMinutes - breaksInMinutes;
    return actualWorkTime - MINUTES_TO_WORK;
};

var overtimeThisMonth = function (done) {
    console.log('Build summary...');

    var parameters = createParameters({
        range_start: moment().startOf('month').utc(true).toISOString(),
        range_end: moment().endOf('month').utc(true).toISOString()
    });

    request({
        url: WORKING_SESSIONS,
        qs: parameters,
        headers: headers
    }, function (error, response, body) {
        var data = JSON.parse(body);

        var details = R.map(function (session) {
            return {
                session: session,
                overtime: getOvertimeFromSession(session)
            };
        }, data.working_sessions);

        var overtimeInMinutes = R.reduce(function (acc, session) {
            acc += session.overtime;
            return acc;
        }, 0, details);

        done({
            details: details,
            overtimeInMinutes: overtimeInMinutes
        });
    });
};

const handleCommand = function (cmd) {
    switch (cmd) {
        case 'overtime':
            var result = overtimeThisMonth(function (result) {
                var table = new Table({
                    head: ['Date', 'Weekday', 'Worked', 'Overtime'],
                    colWidths: [30, 30, 30, 30]
                });

                R.forEach(function (detail) {
                    var session = detail.session;
                    var date = moment(session.starts_at).utc(true).format('DD.MM.YYYY');
                    var weekday = moment(session.starts_at).utc(true).format('dddd');
                    var worked = getDifferenceInMinutes(moment(session.starts_at), session.ends_at ? moment(session.ends_at) : moment());
                    var overtime = detail.overtime;

                    worked = getHumanReadableTextFromMinutes(worked);
                    overtime = getHumanReadableTextFromMinutes(overtime);

                    table.push([
                        date,
                        weekday,
                        worked,
                        overtime
                    ])
                }, result.details);

                console.log(table.toString());
                console.log('Overtime this month:', getHumanReadableTextFromMinutes(result.overtimeInMinutes));
            });

            break;
        case 'today':
            todaySummary();
            break;
        default:
            break;
    }
};

program.version('0.0.1')
    .arguments('[cmd]')
    .action(handleCommand)
    .parse(process.argv);
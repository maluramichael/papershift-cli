#!/usr/bin/env node

var program = require('commander');
var request = require('request');
var moment = require('moment');
var R = require('ramda');
var Table = require('cli-table');
var chalk = require('chalk');
var fs = require('fs');
var path = require('path');

var user = process.env.PAPERSHIFT_USER;
var auth_token = process.env.PAPERSHIFT_TOKEN;

if (!user || !auth_token) {
    var p = path.join(process.env['HOME'], '.papershift-cli');
    if (fs.existsSync(p)) {
        var content = fs.readFileSync(p).toString();
        var credentials = JSON.parse(content);
        user = user || credentials.user;
        auth_token = auth_token || credentials.auth_token;
    } else {
        fs.closeSync(fs.openSync(p, 'w'));
        fs.writeFileSync(p, JSON.stringify({
            user: '',
            auth_token: ''
        }));
    }
}

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
var DATE_FORMAT = 'HH:mm';

function padLeft(num, size) {
    var s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

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

var getHumanReadableTextFromMinutes = function (minutes, colored = false) {
    var duration = moment.duration(minutes, 'minutes');
    var negative = duration < 0;

    var value = [
        padLeft(Math.abs(duration.hours()), 2),
        padLeft(Math.abs(duration.minutes()), 2)
    ].join(':');

    if (colored) {
        return chalk[negative ? 'red' : 'green'](value);
    } else {
        return (negative ? '-' : '') + value;
    }
};

const getDifferenceInMinutes = function (start, end) {
    var duration = moment.duration(start.diff(end));
    return Math.floor(Math.abs(duration.asMinutes()));
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

const getOvertimeFromMinutes = function (workTimeInMinutes, breaksInMinutes) {
    return workTimeInMinutes - breaksInMinutes - MINUTES_TO_WORK;
}

const getOvertimeFromSession = function (session) {
    const breaksInMinutes = getBreaksInMinutes(session.breaks);
    const workTimeInMinutes = getWorkTimeInMinutes(session);

    const actualWorkTime = workTimeInMinutes - breaksInMinutes;
    return actualWorkTime - MINUTES_TO_WORK;
};

var fetchAllWorkingSessions = function (options, done) {
    var sessions = [];

    var parameters = createParameters({
        range_start: options.from || moment().startOf('month').subtract(2, 'months').utc(true).toISOString(),
        range_end: options.to || moment().endOf('day').utc(true).toISOString()
    });

    function next(nextUrl) {
        if (nextUrl) {
            request({
                url: nextUrl,
                qs: parameters,
                headers: headers,
                rejectUnauthorized: false
            }, function (error, response, body) {
                if (error) {
                    console.error(error);
                    return;
                }

                var data = JSON.parse(body);

                var details = R.map(function (session) {
                    return {
                        session: session,
                        breaksInMinutes: getBreaksInMinutes(session.breaks),
                        overtimeInMinutes: getOvertimeFromSession(session)
                    };
                }, data.working_sessions);

                var overtimeInMinutes = R.reduce(function (acc, session) {
                    acc += session.overtimeInMinutes;
                    return acc;
                }, 0, details);

                sessions = sessions.concat(details);
                if (data.next_page) {
                    return next(data.next_page);
                } else {
                    var uniqSessions = R.uniqBy(function (session) {
                        return session.session.id;
                    }, sessions);
                    return done(uniqSessions);
                }
            });
        }
    }

    next(WORKING_SESSIONS);
}

var createTable = function () {
    return new Table({
        head: ['Date', 'Day', 'Begin', 'End', 'Work', 'Breaks', 'Over', 'Sessions'],
        colWidths: [12, 15, 9, 9, 9, 9, 9, 10],
        colAligns: ['middle', 'right', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle'],
        style: {
            compact: true,
            'padding-left': 1,
            head: ['white']
        }
    });
}

var mapSessionsToDays = function (sessions) {
    var days = R.sortBy(function (detail) {
        return moment(detail.session.starts_at);
    }, sessions);

    days = R.map(function (e) {
        var session = e.session;
        var start = moment(session.starts_at).utc(true);
        var date = start.format('DD.MM.YYYY');
        var weekday = start.format('dddd');
        var end = (session.ends_at ? moment(session.ends_at) : moment()).utc(true);
        var worked = getDifferenceInMinutes(start, end);
        worked -= e.breaksInMinutes;
        var overtime = e.overtimeInMinutes;
        var breaks = e.breaksInMinutes;

        return {
            start: start,
            end: end,
            date: date,
            weekday: weekday,
            worked: worked,
            overtime: overtime,
            breaks: breaks
        }
    }, days);

    days = R.values(R.groupBy(function (e) {
        return e.date;
    }, days));

    days = R.map(function (current) {
        if (R.is(Array, current) && current.length === 1) {
            return current[0];
        } else {
            return current;
        }
    }, days);

    days = R.reduce(function (acc, current) {
        var sesssionCount = 1;

        if (R.is(Array, current)) {
            sesssionCount = current.length;

            current = R.reduce(function (acc, current) {
                var calc = {
                    start: acc.start ? (current.start < acc.start ? current.start : acc.start) : current.start,
                    end: acc.end ? (R.max(current.end, acc.end)) : current.end,
                    worked: (acc.worked || 0) + current.worked,
                    breaks: (acc.breaks || 0) + current.breaks,
                }
                calc.overtime = getOvertimeFromMinutes(calc.worked, calc.breaks)
                return R.merge(acc, calc);
            }, {
                weekday: R.head(current).weekday,
                date: R.head(current).date
            }, current);

            current.multipleSessions = sesssionCount;
        }
        acc.push(current);

        return acc;
    }, [], days);

    return days;
}

var addTableRow = function (table, detail, colored = false) {
    table.push([
        detail.date,
        detail.weekday,
        detail.start.format('HH:mm'),
        detail.end.format('HH:mm'),
        getHumanReadableTextFromMinutes(detail.worked,colored),
        detail.breaks > 0 ? getHumanReadableTextFromMinutes(detail.breaks,colored) : '',
        detail.overtime !== 0 ? getHumanReadableTextFromMinutes(detail.overtime, colored) : '',
        detail.multipleSessions || ''
    ])
}

var monthAction = function (cmd, options) {
    fetchAllWorkingSessions({
        from: moment().startOf('month').utc(true).toISOString(),
        to: moment().endOf('month').utc(true).toISOString()
    }, function (sessions) {
        var table = createTable();
        var days = mapSessionsToDays(sessions);

        R.forEach(function (row) {
            addTableRow(table, row)
        }, days);

        var overtimeInMinutes = R.reduce(function (acc, session) {
            acc += session.overtime;
            return acc;
        }, 0, days);

        console.log(table.toString());
        console.log('Summary:', getHumanReadableTextFromMinutes(overtimeInMinutes, true));
    });
};

var overviewAction = function (cmd, options) {
    fetchAllWorkingSessions({
        from: moment().startOf('month').subtract(2, 'months').utc(true).toISOString(),
        to: moment().endOf('day').utc(true).toISOString()
    }, function (sessions) {
        var table = createTable();
        var days = mapSessionsToDays(sessions);

        R.forEach(function (row) {
            addTableRow(table, row)
        }, days);

        var overtimeInMinutes = R.reduce(function (acc, session) {
            acc += session.overtime;
            return acc;
        }, 0, days);

        console.log(table.toString());
        console.log('Summary:', getHumanReadableTextFromMinutes(overtimeInMinutes, true));
    });
};

var todayAction = function (cmd = { parent:{} }, options) {
    fetchAllWorkingSessions({
        from: moment().startOf('day').utc(true).toISOString(),
        to: moment().endOf('day').utc(true).toISOString()
    }, function (sessions) {
        if (cmd.parent.short) {
            var today = R.head(mapSessionsToDays(sessions));

            var start = today.start.format('HH:mm');
            var end = today.end.format('HH:mm');
            var worked = getHumanReadableTextFromMinutes(today.worked);
            var breaks = today.breaks > 0 ? getHumanReadableTextFromMinutes(today.breaks) : getHumanReadableTextFromMinutes(0);
            var overtime = today.overtime !== 0 ? getHumanReadableTextFromMinutes(today.overtime, cmd.parent.colored) : getHumanReadableTextFromMinutes(0);

            console.log(start, worked, breaks, overtime);
        } else {
            var table = createTable();
            var days = mapSessionsToDays(sessions);

            R.forEach(function (row) {
                addTableRow(table, row, cmd.parent.colored)
            }, days);

            var overtimeInMinutes = R.reduce(function (acc, session) {
                acc += session.overtime;
                return acc;
            }, 0, days);

            console.log(table.toString());
        }
    });
};

var pkg = require('./package.json');

program.version(pkg.version)
    .option('-c, --colored')
    .option('-s, --short');

program.command('today')
    .description('prints current day')
    .action(todayAction);

program.command('overview')
    .description('prints an overview')
    .action(overviewAction);

program.command('month')
    .description('prints an overview for the current month')
    .action(monthAction);

program.parse(process.argv);

if (process.argv.length === 2) {
    todayAction();
}
#!/usr/bin/env node

const program = require('commander');
const request = require('request');
const moment = require('moment');
const R = require('ramda');
const table = require('cli-table');

const user = process.env.PAPERSHIFT_USER;
const auth_token = process.env.PAPERSHIFT_TOKEN;

if (!user) {
    console.error('PAPERSHIFT_USER Environment variable is not defiend');
    return 1;
}
if (!auth_token) {
    console.error('PAPERSHIFT_TOKEN Environment variable is not defiend');
    return 1;
}

program.version('0.0.1').parse(process.argv);

const URL = 'https://app.papershift.com/public_api/v1/';
const WORKING_SESSIONS = URL + 'working_sessions';

const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

const defaultParameters = {
    api_token: auth_token,
    user_id: user
};

const createParameters = function (parameters) {
    return Object.assign({}, defaultParameters, parameters);
};

const NOW = moment();

const getTimeDiffText = function (start, end, breakMinutes) {
    if (breakMinutes) {
        if (start > end) {
            start.subtract(breakMinutes, 'minutes');
        } else {
            end.subtract(breakMinutes, 'minutes');
        }
    }
    const duration = moment.duration(start.diff(end));
    return [
        Math.abs(duration.hours()),
        Math.abs(duration.minutes()),
        Math.abs(duration.seconds())
    ].join(':');
};

const getTimeDiff = function (start, end) {
    const duration = moment.duration(start.diff(end));
    return Math.floor(Math.abs(duration.asMinutes()));
};

const todaySummary = function () {
    console.log('Build summary...');
    const parameters = createParameters({
        range_start: moment().utc().toISOString(),
        range_end: moment().add(1, 'days').utc().toISOString()
    });

    request({url: WORKING_SESSIONS, qs: parameters, headers: headers}, function (error, response, body) {
        const data = JSON.parse(body);
        const current = R.head(data.working_sessions);
        if (current) {
            const breaks = current.breaks;
            var breakMinutes = 0;
            if (breaks) {
                breakMinutes = R.map(function (current) {
                    const start = current.starts_at ? moment(current.starts_at) : null;
                    const end = current.ends_at ? moment(current.ends_at) : null;

                    if (start && end) {
                        return getTimeDiff(start, end);
                    } else {
                        return 0;
                    }
                }, breaks);
                breakMinutes = R.sum(breakMinutes);
            }

            const start = current.starts_at ? moment(current.starts_at) : null;
            const end = current.ends_at ? moment(current.ends_at) : null;

            if (start && end) {
                const timeString = getTimeDiffText(start, end, breakMinutes);
                console.log('Worked from', start.format('HH:mm'), 'to', end.format('HH:mm'), 'workd for', timeString);
            } else if (start) {
                const timeString = getTimeDiffText(start, NOW, breakMinutes);
                console.log('Started at', start.format('HH:mm'), 'worked for', timeString);
            } else {
                console.error('Something went wrong');
            }
        } else {
            console.error('Not worked today');
        }
    });
};

todaySummary();
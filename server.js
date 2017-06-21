/**
 * Created by anatal on 3/17/17.
 */
const http = require('http');
// Serve client side statically
const express = require('express');
const bodyParser = require('body-parser');
const process = require('process');
const cp = require('child_process');
const request = require('request');
const Joi = require('joi');

const app = express();
const server = http.createServer(app);

const ASR_HOST = process.env.ASR_HOST;
const ASR_PORT = process.env.ASR_PORT;

const configSchema =  Joi.object({
  asr_host: Joi.string().hostname(),
  asr_port: Joi.number().integer().positive().default(80)
});

Joi.assert({
  asr_host: ASR_HOST, // e.g. 10.252.24.90
  asr_port: ASR_PORT
}, configSchema);

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  // Prevent browsers mistaking user provided content as HTML
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');

  next();
});

app.use(
  bodyParser.raw({
    limit: 1024000,
    type: function () {
      return true;
    }
  })
);


app.use(function (req, res) {
  // then we convert it from opus to raw pcm
  const opusdec = cp.spawn('firejail', [
    '--profile=opusdec.profile',
    '--debug',
    '--force',
    'opusdec',
    '--rate',
    '16000',
    '-',
    '-'
  ], {stdio: ['pipe', 'pipe', 'pipe']});

  opusdec.on('error', function (err) {
    process.stderr.write('Failed to start child process:', err, '\n');
    res.status(500);
    res.end();
  });

  opusdec.stdin.write(req.body);
  opusdec.stdin.end();

  // no-op to not fill up the buffer
  opusdec.stderr.on('data', function (data) {
    process.stderr.write(data.toString('utf8'));
  });

  opusdec.on('close', function (code) {
    if (code !== 0) {
      res.status(500);
      res.end();
    }
  });

  // send to the asr server
  request({
    url: `http://${ASR_HOST}:${ASR_PORT}/asr`,
    method: 'POST',
    body: opusdec.stdout,
    headers: {'Content-Type': 'application/octet-stream'},
    qs: {'endofspeech': 'false', 'nbest': 10}
  }, function (asrErr, asrRes, asrBody) {
    // and send back the results to the client
    if (asrErr) {
      res.status(502);
      return res.end();
    }
    const resBody = asrBody && asrBody.toString('utf8');

    res.status(200);
    res.setHeader('Content-Type', 'text/plain');
    res.write(resBody);
    return res.end();
  });
});

server.listen(9001);
process.stdout.write('HTTP and BinaryJS server started on port 9001\n');

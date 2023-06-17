const winston = require('winston')
// const {LoggingWinston} = require('@google-cloud/logging-winston');

// const transport = new winston.transports.Console({
//   format: winston.format.combine(
//     winston.format.simple(),
//     // winston.format.prettyPrint(),
//     // Format the metadata object
//     winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] })
//   )
// })
// winston.add(transport)

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console()
  ]
})

module.exports = logger

// module.exports = winston

const winston = require('winston');
const transport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.simple(),
    // winston.format.prettyPrint(),
    // Format the metadata object
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] })
  )
});
winston.add(transport);

module.exports=winston;



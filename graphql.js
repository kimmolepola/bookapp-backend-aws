require('dotenv').config();
const { ApolloServer } = require('apollo-server-lambda');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const typeDefs = require('./typeDefs');
const resolversCreator = require('./resolvers');

const { JWT_SECRET } = process.env;

mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);

const { MONGODB_URI } = process.env;

let conn = null;

const initConnection = async () => {
  if (conn == null) {
    console.log('connecting to mongoDB'); // eslint-disable-line no-console
    conn = mongoose.createConnection(MONGODB_URI, {
      bufferCommands: false, // Disable mongoose buffering
      bufferMaxEntries: 0, // and MongoDB driver buffering
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
  return conn;
};

exports.graphqlHandler = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false; // eslint-disable-line no-param-reassign
  //  warmup plugin early return
  if (event.source === 'serverless-plugin-warmup' || (context.custom && context.custom.source === 'serverless-plugin-warmup')) {
    console.log('WarmUp - Lambda is warm!'); // eslint-disable-line no-console
    callback(null, {
      statusCode: 200,
      body: 'warmed',
    });
  } else {
    initConnection().then((connection) => {
      console.log('connected to mongoDB, creating handler'); // eslint-disable-line no-console

      const rslvrs = resolversCreator({
        connection,
        JWT_SECRET,
        jwt,
        event,
      });

      const server = new ApolloServer({
        typeDefs,
        resolvers: rslvrs.resolvers,
        playground: {
          endpoint: '/prod/graphql',
        },
        context: rslvrs.context,
      });

      server.createHandler({
        cors: {
          origin: true,
          credentials: true,
        },
      })(event, context, callback);
    }).catch((error) => {
      console.log('error connecting to MongoDB:', error.message); // eslint-disable-line no-console
    });
  }
};

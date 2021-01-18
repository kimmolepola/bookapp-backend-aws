require('dotenv').config();
const {
  ApolloServer, UserInputError, AuthenticationError, gql,
} = require('apollo-server-lambda');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const UserSchema = require('./models/User');
const AuthorSchema = require('./models/Author');
const BookSchema = require('./models/Book');

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

/*
exports.graphqlHandler = server.createHandler({
  cors: {
    origin: true,
    credentials: true,
  },
});
*/

/*
const connect = initConnection(); // initConnection() will return a promise

const graphQLHandler = server.createHandler({
  cors: {
    origin: '*',
    credentials: true,
  },
});

exports.handler = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false; // eslint-disable-line no-param-reassign

  // initConnection will run only once and after that the promise is fulfilled
  connect.then((connection) => graphQLHandler(event, context, callback));
};
*/

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
      console.log(connection); // eslint-disable-line no-console


      const Author = connection.model('Author', AuthorSchema);
      const Book = connection.model('Book', BookSchema);
      const User = connection.model('User', UserSchema);

      // Construct a schema, using GraphQL schema language
      /*
const typeDefs = gql`
  type Query {
    hello: String
  }
`;
*/

      const typeDefs = gql`
  type Author {
    name: String!
    id: ID
    born: Int
    bookCount: Int
  }
  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]
    id: ID!
  }
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }
  type Token {
    value: String!
  }
  type Subscription {
    bookAdded: Book!
  }
  type Mutation {
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
    addBook(
      title: String!
      author: String
      published: Int
      genres: [String!]
    ): Book
  }
  type Query {
    allGenres: [String!]!
    me: User
    allAuthors: [Author!]!
    allBooks(author: String, genre: String): [Book!]!
    authorCount: Int!
    bookCount: Int!
  }
  `;

      // Provide resolver functions for your schema fields
      /*
const resolvers = {
  Query: {
    hello: () => 'Hello world!',
  },
};
*/

      const resolvers = {
        Mutation: {
          createUser: (root, args) => {
            const user = new User({ username: args.username, favoriteGenre: args.favoriteGenre });

            return user.save()
              .catch((error) => {
                throw new UserInputError(error.message, { invalidArgs: args });
              });
          },
          login: async (root, args) => {
            const user = await User.findOne({ username: args.username });
            if (!user || args.password !== 'qwer') {
              throw new UserInputError('wrong credentials');
            }
            const userForToken = {
              username: user.username,
              id: user._id, // eslint-disable-line no-underscore-dangle
            };
            return { value: jwt.sign(userForToken, JWT_SECRET) };
          },
          editAuthor: async (root, args, { currentUser }) => {
            if (!currentUser) {
              throw new AuthenticationError('not authenticated');
            }
            const author = await Author.findOne({ name: args.name });
            author.born = args.setBornTo;
            try {
              await author.save();
            } catch (error) {
              throw new UserInputError(error.message, {
                invalidArgs: args,
              });
            }
            return author;
          },

          addBook: async (root, args, { currentUser }) => {
            if (!currentUser) {
              throw new AuthenticationError('not authenticated');
            }
            let authorObj = await Author.findOne({ name: args.author });
            if (!authorObj) {
              authorObj = new Author({ name: args.author, bookCount: 0 });
              authorObj = await authorObj.save();
            }
            const book = new Book({ ...args, author: authorObj });
            try {
              await book.save();
            } catch (error) {
              throw new UserInputError(error.message, {
                invalidArgs: args,
              });
            }
            authorObj.bookCount += 1;
            authorObj.save();
            // pubsub.publish('BOOK_ADDED', { bookAdded: book });
            return book;
          },
        },

        /*
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED']),
    },
  },
  */

        Query: {
          allGenres: async () => Object.keys((await Book.find({})).reduce((acc, cur) => {
            cur.genres.map((x) => acc[x] = true); // eslint-disable-line no-return-assign
            return acc;
          }, [])),
          me: (root, args, querycontext) => querycontext.currentUser,
          allAuthors: () => Author.find({}),
          allBooks: (root, args) => (args.genre === ''
            ? Book.find({}).populate('author')
            : Book.find({ genres: { $in: [args.genre] } }).populate('author')),
          authorCount: () => Author.collection.countDocuments(),
          bookCount: () => Book.collection.countDocuments(),
        },
      };

      const server = new ApolloServer({
        typeDefs,
        resolvers,
        playground: {
          endpoint: '/dev/graphql',
        },
        context: async ({ request }) => { // eslint-disable-line consistent-return
          const auth = request ? request.headers.authorization : null;
          if (auth && auth.toLowerCase().startsWith('bearer ')) {
            const decodedToken = jwt.verify(
              auth.substring(7), JWT_SECRET,
            );
            const currentUser = await User.findById(decodedToken.id);
            return { currentUser };
          }
        },
      });


      server.createHandler({
        cors: {
          origin: '*',
          credentials: true,
        },
      })(event, context, callback);
    }).catch((error) => {
      console.log('error connecting to MongoDB:', error.message); // eslint-disable-line no-console
    });
  }
};

const {
  UserInputError, AuthenticationError,
} = require('apollo-server-lambda');
const UserSchema = require('./models/User');
const AuthorSchema = require('./models/Author');
const BookSchema = require('./models/Book');

const createResolvers = ({
  connection, jwt, JWT_SECRET, event,
}) => {
  const Author = connection.model('Author', AuthorSchema);
  const Book = connection.model('Book', BookSchema);
  const User = connection.model('User', UserSchema);

  const context = async () => { // eslint-disable-line consistent-return
    // const auth = request ? request.headers.authorization : null;
    const auth = event ? event.headers ? event.headers.Authorization : null : null; // eslint-disable-line no-nested-ternary, max-len
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7), JWT_SECRET,
      );
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }
  };

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

        return book;
      },
    },

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

  return { resolvers, context };
};

module.exports = createResolvers;

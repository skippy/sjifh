FROM mcr.microsoft.com/playwright:v1.33.0
# FROM mcr.microsoft.com/playwright:next

RUN apt-get update && \
	curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
	apt-get install -y nodejs

WORKDIR /usr/src/app

# this makes builds much faster
COPY package*.json ./
RUN npm install

COPY . .

# Expose the port that your Express.js application listens on
EXPOSE 3000

# Set the command to run your application
#CMD ["yarn", "start"]

